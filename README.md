# LeaseLens 🔎

**감사인 관점의 IFRS 16(K-IFRS 1116) 리스 계약서 AI 추출 · 독립 재계산 · 검증 플랫폼**

리스 계약서를 AI로 추출(근거조항·신뢰도 포함) → IFRS 16 독립 재계산 → 이상탐지·감사조서까지 한 흐름으로 잇는다. 시장의 리스 솔루션이 *작성자(preparer) 도구*라면, LeaseLens는 **감사인(auditor) 도구**다.

> 회계감사 실무 자동화 포트폴리오. conversion / XBRL 프로젝트에 이은 세 번째 작품. → 상세 기획은 [`docs/기획안.md`](docs/기획안.md)

---

## 핵심 차별점

| | 기존 자동화 | LeaseLens |
|---|---|---|
| 입력 출처 | 사람이 옮겨 적음 | **AI 추출 + 근거조항/신뢰도** 보존 |
| 검증 | 입력을 신뢰 | **독립 재계산** + 회사수치 차이 플래그 |
| 판단영역 | 사용자 몫 | 선택권·변동리스료·복구의무 **자동 질문 생성** |
| 가정 | 블랙박스 | 할인율 환산(유효/명목)·선급/후급 **노출** |
| 산출물 | 숫자 | **감사조서(.md)** 자동 생성 |

## 기능

1. **PDF 계약서 직접 추출** — 업로드 PDF의 텍스트 레이어를 서버(`/api/parse-pdf`, pdfjs-dist)에서 추출. 텍스트 레이어가 없는 **스캔본은 자동 감지**해 브라우저 OCR(한/영, tesseract.js)로 폴백하며, OCR 결과는 원본 대조를 권고한다.
2. **계약서 AI 추출** — 규칙기반(키 불필요) / LLM(`/api/extract`) 동일 스키마. 필드별 `값+신뢰도+근거조항`.
3. **IFRS 16 계산 엔진** — 리스부채 PV·사용권자산·상각표·개시분개. 외부 의존성 0, 단위테스트 6종 통과.
4. **감사 검증** — 독립 재계산, 할인율 합리성·완전성·표시공시 이상탐지(심각도+권고절차).
5. **감사조서 내보내기** — 추적 가능한 워크페이퍼(.md).

## 로컬 실행

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # IFRS 16 엔진 단위테스트
npm run build    # 프로덕션 빌드 검증
```

## 배포 (Vercel)

1. 이 저장소를 GitHub에 push.
2. Vercel에서 New Project → 저장소 선택 → 프레임워크 자동감지(Next.js) → Deploy.
3. (선택) LLM 추출을 쓰려면 환경변수 설정 — `.env.example` 참고:
   - `ANTHROPIC_API_KEY` (Gen AI API), 또는
   - `OLLAMA_HOST` (오픈소스 LLM 로컬/자가호스팅, 예 `http://localhost:11434`)
   - 둘 다 없어도 **규칙기반으로 동작**하므로 키 없이 즉시 데모 가능.

## 기술 스택

**Node.js · TypeScript · Next.js 14 (App Router, React)** · Tailwind CSS · Node 내장 test runner · **Gen AI API(Anthropic) + 오픈소스 LLM(Ollama)** 멀티 프로바이더 추출 · **pdfjs-dist**(PDF 텍스트 추출) · **tesseract.js**(브라우저 OCR, 한/영)

> 디지털 역량 어필 포인트: 프로그래밍(Next.js·Node.js·자동화) + AI 활용(Gen AI API·Ollama) 멀티 트랙.

## 구조

```
app/
  page.tsx                대시보드 UI (PDF 업로드 포함)
  api/extract/route.ts    LLM 추출 (선택)
  api/parse-pdf/route.ts  PDF 텍스트 레이어 추출 (pdfjs-dist)
lib/
  ifrs16/   engine.ts · types.ts · engine.test.ts   ← 계산 엔진
  extraction/ extractor.ts · schema.ts · pdf.ts     ← 추출 (pdf.ts: PDF/OCR)
  audit/    checks.ts · workpaper.ts                ← 검증·조서
  data/     samples.ts                              ← 샘플 계약서 3종
docs/       기획안.md
```

## 면책

감사 보조용 도구이며 전문가의 판단을 대체하지 않습니다. 임계값(할인율 밴드, 허용오차)은 감사 정책에 맞게 조정하십시오.
