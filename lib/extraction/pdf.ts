// PDF 처리 클라이언트 헬퍼.
//   parsePdf : 서버(/api/parse-pdf)로 PDF를 보내 텍스트 레이어를 추출한다(디지털 PDF용).
//   ocrPdf   : 텍스트 레이어가 없는 스캔본을 위해 브라우저에서 직접 OCR한다.
//              pdfjs-dist로 각 페이지를 캔버스로 렌더 → tesseract.js(kor+eng)로 인식.
//              네이티브 의존성이 없어 Vercel 빌드/배포에 영향을 주지 않으며,
//              무거운 라이브러리는 호출 시점에 동적 import 한다(메인 번들·SSR 회피).

export interface PdfParseResponse {
  fileName: string;
  pages: number;
  charCount: number;
  charsPerPage: number;
  scanned: boolean;
  text: string;
  note: string;
}

/** 서버 텍스트 레이어 추출 */
export async function parsePdf(file: File): Promise<PdfParseResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse-pdf", { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `parse-pdf ${res.status}`);
  }
  return (await res.json()) as PdfParseResponse;
}

/** OCR 진행 상태 콜백 (0~1, 현재 페이지/전체) */
export type OcrProgress = (info: {
  page: number;
  pages: number;
  ratio: number;
}) => void;

const OCR_MAX_PAGES = 10; // 데모 안정성: 과도한 페이지 방어
const OCR_SCALE = 2; // 렌더 배율(인식 정확도↑)

/** 브라우저 OCR: 스캔본 PDF → 텍스트 (한국어+영어) */
export async function ocrPdf(
  file: File,
  onProgress?: OcrProgress
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("ocrPdf는 브라우저에서만 실행됩니다.");
  }

  const pdfjs = await import("pdfjs-dist");
  // 워커 소스를 런타임 버전에 맞춰 CDN으로 지정(번들러 설정 불필요).
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const { createWorker } = await import("tesseract.js");

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageCount = Math.min(pdf.numPages, OCR_MAX_PAGES);

  const worker = await createWorker("kor+eng");
  try {
    const chunks: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d 컨텍스트를 생성할 수 없습니다.");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const {
        data: { text },
      } = await worker.recognize(canvas);
      chunks.push(text);
      onProgress?.({ page: i, pages: pageCount, ratio: i / pageCount });
    }
    return chunks.join("\n\n").trim();
  } finally {
    await worker.terminate();
  }
}
