<div align="center">

# LeaseLens — IFRS 16 리스 감사 자동화 엔진

리스 계약서를 AI로 추출하고 K-IFRS 제1116호에 따라<br/>
독립 재계산·검증하는 **감사인 관점의 End-to-End 플랫폼**

![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)
![pdfjs-dist](https://img.shields.io/badge/PDF-pdfjs--dist-EC1C24?logo=adobeacrobatreader&logoColor=white)
![tesseract.js](https://img.shields.io/badge/OCR-tesseract.js-4E9A06)
![Tests](https://img.shields.io/badge/Tests-6_passing-3FB950)
![License](https://img.shields.io/badge/License-MIT-3FB950)
![Live Demo](https://img.shields.io/badge/▲_Live_Demo-Vercel-000000?logo=vercel&logoColor=white)

🔗 **Live Demo** → https://lease-sandy.vercel.app

</div>

## Overview

K-IFRS 제1116호(리스)는 거의 모든 리스를 사용권자산·리스부채로 재무상태표에 인식하도록 요구합니다. 기업과 감사인은 리스별 현재가치·상각표·재측정을 반복 산출해야 하는데, 이 과정은 여전히 엑셀과 수작업에 의존해 수식 오류·감사증적 부재·입력 왜곡에 취약합니다.

시장의 리스 솔루션 대부분은 *작성자(preparer) 도구*로서 "계산·전기 자동화"에 초점이 맞춰져 있습니다. 이 프로젝트는 같은 데이터 위에서 동작하는 **감사인(auditor) 도구**입니다. 계약서에서 조건을 추출(근거조항·신뢰도 포함)하고, 회사 수치를 믿지 않고 **독립적으로 재계산**해 차이를 탐지하며, 위험을 자동 플래그하고 추적 가능한 감사조서로 내보냅니다. 외부 API 키 없이도 규칙기반으로 즉시 동작합니다.

## Key Capabilities

| 기능 | 설명 |
|---|---|
| PDF 직접 추출 | 업로드 PDF의 텍스트 레이어를 서버(pdfjs-dist)에서 추출. 텍스트 레이어가 없는 **스캔본은 자동 감지**해 브라우저 OCR(tesseract.js, 한/영)로 폴백 |
| 계약서 조건 추출 | 규칙기반(키 불필요) 또는 LLM(Gen AI API/오픈소스 Ollama)이 **동일 스키마**로 추출. 13개 필드를 `값 + 신뢰도(0~1) + 근거조항`으로 보존 |
| IFRS 16 계산 엔진 | 리스부채 현재가치·사용권자산·상각표·개시 분개를 결정론적으로 산출. 외부 의존성 0, 모든 중간값 노출(감사 재계산 가능) |
| 독립 재계산·이상탐지 | 회사 제시 수치와 독립 재계산을 비교해 허용오차 초과 시 플래그. 완전성·정확성·평가·표시공시 축으로 위험을 분류하고 권고 절차 부여 |
| 감사조서 자동 생성 | 추출표(근거 포함)·재계산·발견사항·상각표를 추적 가능한 워크페이퍼(.md)로 내보내기 |
| 웹 인터페이스 | PDF 업로드 또는 예시 계약서 불러오기 → 추출·재계산·검증·조서 다운로드까지 원스톱. **입력이 없으면 분석이 실행되지 않음** |

> 핵심 차별점: 시장 솔루션이 입력을 신뢰하고 계산만 한다면, LeaseLens는 **근거 추적 → 독립 재계산 → 이상탐지 → 감사조서**라는 감사 절차 자체를 제품화했습니다.

## Architecture

추출(서버 PDF/OCR) → 계산 엔진 → 감사 검증 → 산출(대시보드/조서)의 단방향 파이프라인이며, 추출 레이어는 규칙기반/LLM 어느 쪽이든 동일한 스키마를 반환하므로 다운스트림이 동일하게 동작합니다.

### Project Structure

```
.
├── app/
│   ├── page.tsx                  # 대시보드 UI — 입력 게이팅·결과 시각화 (768 lines)
│   └── api/
│       ├── extract/route.ts      # LLM 추출 엔드포인트 (Anthropic/Ollama) (97 lines)
│       └── parse-pdf/route.ts    # PDF 텍스트 레이어 추출 (pdfjs-dist) (72 lines)
│
├── lib/
│   ├── ifrs16/                   # IFRS 16 계산 엔진
│   │   ├── engine.ts             #   리스부채 PV·상각표·사용권자산·분개 (198 lines)
│   │   ├── types.ts              #   도메인 타입 (73 lines)
│   │   └── engine.test.ts        #   단위테스트 6종 (81 lines)
│   │
│   ├── extraction/               # 계약서 → 구조화 추출
│   │   ├── extractor.ts          #   규칙기반 추출·부정어 처리·LLM 응답 보정 (222 lines)
│   │   ├── schema.ts             #   추출 스키마 (값+신뢰도+근거) (48 lines)
│   │   └── pdf.ts                #   PDF 파싱 호출 + 브라우저 OCR (82 lines)
│   │
│   ├── audit/                    # 감사 검증 레이어
│   │   ├── checks.ts             #   독립 재계산·이상탐지·위험 플래그 (181 lines)
│   │   └── workpaper.ts          #   감사조서(.md) 생성 (80 lines)
│   │
│   └── data/
│       └── samples.ts            # 데모 계약서 4종 (79 lines)
│
└── docs/
    └── 기획안.md                  # 상세 기획·설계 문서
```

## How It Works

### 1. 계약서 입력 & 추출

시작은 빈 상태이며, **PDF 업로드(드래그&드롭)** 또는 **예시 계약서 불러오기**로 계약서를 명시적으로 입력해야만 분석이 실행됩니다. 입력이 없으면 `추출 → 분석` 버튼이 비활성화됩니다.

```
계약서 입력 (PDF 업로드 / 예시 / 직접 붙여넣기)
        │  PDF는 서버 pdfjs-dist로 텍스트 추출, 스캔본이면 브라우저 OCR(한/영) 폴백
        ▼
[추출] 규칙기반(기본) 또는 LLM
        ▼
ExtractedLease { 13개 필드 × (값 + 신뢰도 + 근거조항) }
```

좌측 패널의 **`LLM 추출` 토글**이 추출 엔진을 결정합니다.

| 구분 | 규칙기반 (체크 해제·기본) | LLM 추출 (체크) |
|---|---|---|
| 동작 위치 | 브라우저, 즉시·오프라인 | 서버 `/api/extract` 호출 |
| 방식 | 정규식·휴리스틱으로 라벨 인식 | Gen AI API(Anthropic) 또는 오픈소스 LLM(Ollama)이 문맥 이해 |
| 키 필요 | 불필요 | `ANTHROPIC_API_KEY` 또는 `OLLAMA_HOST` |
| 강점 | 빠름·결정론적·키 불필요 | 비정형/자유서술 계약서에 강함 |
| 폴백 | — | **키 미설정 시 자동으로 규칙기반으로 폴백** (데모 무중단) |

> LLM을 켜도 서버에 키가 없으면 "API 키 미설정 → 규칙기반으로 폴백" 안내와 함께 규칙기반 결과가 표시됩니다. 실제 LLM 추출은 배포 환경변수에 키를 등록하면 활성화됩니다.

### 2. IFRS 16 독립 재계산

추출값으로 회사와 **독립적으로** 리스부채·사용권자산·상각표를 재계산합니다. 할인율 기간환산은 유효이자율 `(1+r)^(1/m)-1`과 명목분할 `r/m`을 UI에서 전환할 수 있어, 가정이 결과에 미치는 영향을 분해해 볼 수 있습니다.

```
ExtractedLease
   ↓  연 할인율 → 기간이자율 환산 (유효/명목)
리스부채 = 미지급 정기리스료의 현재가치
   ↓
사용권자산 = 리스부채 + 직접원가 + 선급 + 복구원가 − 인센티브
   ↓
상각표(유효이자율법) · 개시일 분개
```

### 3. 감사 검증 — 독립 재계산 차이 & 이상탐지

엔진 재계산값을 회사 제시 수치와 비교합니다. 이것이 화면 우측 "독립 재계산 검증"의 **차이** 표시입니다.

| 차이 (회사수치 대비) | 판정 | 의미 |
|---|---|---|
| ≤ 1% (허용오차) | 🟢 PASS | 회사 수치가 독립 재계산과 일치 — 추가 절차 불요 |
| > 1% | 🔴 FAIL | 회사 계상액과 유의한 차이 — 차이원인(할인율·기간·지급조건) 분해 및 수정사항(AJE) 검토 |

> 예) 차량 리스 샘플: 엔진 리스부채 114,659,074원 vs 회사 제시 108,000,000원 → 차이 6,659,074원(6.17%) **FAIL**. 허용오차(1%)는 감사 정책에 맞게 조정 가능합니다.

이와 함께 경영진 주장(assertion) 축으로 위험을 점검하고, 각 발견사항에 심각도·분류·권고 절차를 부여합니다.

| 분류 | 점검 예시 |
|---|---|
| 완전성 | 필수항목(개시일·기간·리스료·할인율) 누락·저신뢰, 복구원가 미반영 |
| 정확성 | 독립 재계산과 회사 수치의 차이 |
| 평가 | 할인율 합리성(1~15% 밴드), 연장·매수선택권의 리스기간 영향 |
| 표시·공시 | 변동리스료 분리 측정·주석 공시 |

추출 단계의 불리언 조항(선택권·변동리스료·복구의무)은 키워드가 있어도 같은 문장에 "없음/미적용" 등 부정 표현이 오면 미적용(false)으로 판단해 오탐을 방지합니다.

### 4. 감사조서 내보내기

추출표(근거 포함)·재계산·발견사항·상각표를 하나의 추적 가능한 워크페이퍼(.md)로 내보내, 자동화 산출물과 감사문서 사이의 수작업 갭을 제거합니다.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript | 대시보드 UI·결과 시각화 |
| API | Next.js API Routes (Node 런타임) | PDF 추출·LLM 추출 서버리스 엔드포인트 |
| Core Engine | TypeScript (외부 의존성 없음) | IFRS 16 계산·추출·검증 로직 |
| PDF | pdfjs-dist | PDF 텍스트 레이어 추출 (서버) |
| OCR | tesseract.js (한/영) | 스캔본 브라우저 OCR 폴백 (lazy load) |
| AI 추출 | Gen AI API(Anthropic) / 오픈소스 LLM(Ollama) | 선택적 LLM 추출 (멀티 프로바이더) |
| Test | Node 내장 test runner | 계산 엔진 단위테스트 |
| Deploy | Vercel | 서버리스 배포 (GitHub 연동 자동 재배포) |

> 계산 엔진은 외부 패키지 없이 순수 TypeScript로 작성되어 결정론적이며, 모든 중간값을 노출해 감사인의 재수행(re-performance)이 가능합니다. OCR 라이브러리는 동적 import로 초기 번들에 포함되지 않습니다.

## Getting Started

### Prerequisites

- Node.js 18+
- (선택) LLM 추출용 `ANTHROPIC_API_KEY` 또는 `OLLAMA_HOST` — 없어도 규칙기반으로 동작

### Local

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # IFRS 16 엔진 단위테스트 (6종)
npm run build    # 프로덕션 빌드 검증
```

### Environment Variables (선택)

`.env.example` 참고. 둘 다 없으면 규칙기반으로 즉시 데모 가능.

```
ANTHROPIC_API_KEY=...        # Gen AI API (LLM 추출)
# 또는
OLLAMA_HOST=http://localhost:11434   # 오픈소스 LLM 로컬/자가호스팅
```

## Deployment (Vercel)

1. 코드를 GitHub 저장소에 push 합니다.
2. Vercel에서 New Project → Import 로 저장소를 가져옵니다. (Framework Preset은 Next.js 자동 감지)
3. (선택) Settings → Environment Variables 에 `ANTHROPIC_API_KEY` 또는 `OLLAMA_HOST` 를 등록하면 LLM 추출이 활성화됩니다. 미등록 시 규칙기반으로 동작합니다.
4. Deploy 를 누르면 공개 URL이 발급되며, 이후 master 에 push 하면 자동 재배포됩니다.

## Metrics

| 항목 | 수치 |
|---|---|
| 총 소스코드 | 약 2,000 lines (TypeScript) |
| 추출 필드 | 13개 × (값 + 신뢰도 + 근거조항) |
| 계산 엔진 단위테스트 | 6종 (PV·상각표·유효/명목 환산 등) |
| 데모 계약서 | 4종 (정상 / 위험 다수 / 복구의무 / 회사수치 불일치) |
| 위험 플래그 분류 | 4축 (완전성·정확성·평가·표시공시) |
| API 라우트 | 2개 (`/api/extract`, `/api/parse-pdf`) |

## License

This project is licensed under the MIT License.

본 도구는 감사 보조용이며 전문가의 판단·검토를 대체하지 않습니다. 임계값(할인율 밴드, 허용오차)은 감사 정책에 맞게 조정되어야 합니다.
