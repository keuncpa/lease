// PDF 계약서 → 텍스트 추출 엔드포인트 (텍스트 레이어 기반).
//   - 디지털 PDF(텍스트 레이어 존재): pdfjs-dist로 페이지별 텍스트를 추출. 외부 키 불필요.
//   - 스캔/이미지 PDF(텍스트 레이어 없음): 문자밀도가 낮으면 scanned=true로 표시.
//     실제 OCR은 네이티브 의존성을 피하기 위해 클라이언트(tesseract.js)에서 수행한다.
// 감사 관점: 텍스트 레이어가 없는 스캔본은 추출 신뢰도가 낮으므로 원본 대조를 권고한다.
// 추출(서버)과 OCR(클라이언트)을 모두 pdfjs-dist로 통일해 동작을 일관되게 유지한다.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 스캔본 판정 임계값: 페이지당 평균 문자수가 이보다 낮으면 텍스트 레이어 부재로 간주.
const MIN_CHARS_PER_PAGE = 40;
// 업로드 상한 (바이트). 과도한 파일 방어.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "bad_request", message: "multipart 'file' 필드가 필요합니다." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "too_large", message: "PDF 용량 상한(15MB)을 초과했습니다." },
      { status: 413 }
    );
  }

  try {
    // Node 환경용 legacy 빌드를 동적 import (빌드 타임 평가/번들 이슈 회피).
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

    const lines: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ");
      lines.push(pageText);
    }
    const text = lines.join("\n").replace(/[ \t]+/g, " ").trim();
    const pages = doc.numPages || 1;
    // 밀도 판정은 공백 제거 후 실제 글자 수 기준 (원문 text는 그대로 보존).
    const meaningfulChars = text.replace(/\s/g, "").length;
    const charsPerPage = meaningfulChars / pages;
    const scanned = meaningfulChars === 0 || charsPerPage < MIN_CHARS_PER_PAGE;

    return NextResponse.json({
      fileName: file.name,
      pages,
      charCount: meaningfulChars,
      charsPerPage: Math.round(charsPerPage),
      scanned,
      text,
      note: scanned
        ? "텍스트 레이어가 거의 없는 PDF입니다(스캔본 가능성). 클라이언트 OCR을 권장합니다."
        : "텍스트 레이어 추출 완료.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: "parse_failed", detail: String(e) },
      { status: 502 }
    );
  }
}
