// 계약서 → 구조화 리스 조건 추출.
// 두 가지 모드:
//   1) rule-based (데모/오프라인, API키 불필요) — 정규식·휴리스틱
//   2) LLM (api/extract route) — Anthropic 호출, 동일 스키마(JSON) 반환
// 두 모드 모두 ExtractedLease(값+신뢰도+근거)를 반환 → UI/감사검증 공통 처리.

import type { ExtractedField, ExtractedLease } from "./schema";
import type { LeaseInput } from "../ifrs16/types";

function field<T>(
  value: T | null,
  confidence: number,
  evidence: string
): ExtractedField<T> {
  return { value, confidence, evidence };
}

/** 숫자 문자열(콤마/원 포함) → number */
function parseAmount(s: string): number {
  return Number(s.replace(/[^0-9.]/g, ""));
}

/** 한 줄에서 근거 스니펫 추출 */
function snippet(text: string, idx: number, len = 60): string {
  const start = Math.max(0, idx - 10);
  return text.slice(start, start + len).replace(/\s+/g, " ").trim();
}

/** 규칙기반 추출 — 한국어 리스 계약서 대상 */
export function extractRuleBased(text: string): ExtractedLease {
  const t = text.replace(/\r/g, "");

  // 당사자
  const lesseeM = t.match(/(?:리스이용자|임차인|"?을"?)\s*[:：]?\s*([^\n,(]{2,30})/);
  const lessorM = t.match(/(?:리스제공자|임대인|"?갑"?)\s*[:：]?\s*([^\n,(]{2,30})/);

  // 자산
  const assetM = t.match(/(?:기초자산|리스자산|대상\s*자산|대상물건)\s*[:：]?\s*([^\n]{2,40})/);

  // 개시일
  const dateM = t.match(
    /(?:리스개시일|개시일|시작일|계약\s*시작)\s*[:：]?\s*(\d{4})[.\-년/\s]+(\d{1,2})[.\-월/\s]+(\d{1,2})/
  );
  let commencement: string | null = null;
  if (dateM) {
    commencement = `${dateM[1]}-${dateM[2].padStart(2, "0")}-${dateM[3].padStart(2, "0")}`;
  }

  // 리스기간 (년 또는 개월)
  let termMonths: number | null = null;
  let termEvidence = "";
  const termMonthM = t.match(/리스기간[^0-9]{0,10}(\d{1,3})\s*개월/);
  const termYearM = t.match(/리스기간[^0-9]{0,10}(\d{1,2})\s*년/);
  if (termMonthM) {
    termMonths = Number(termMonthM[1]);
    termEvidence = snippet(t, termMonthM.index ?? 0);
  } else if (termYearM) {
    termMonths = Number(termYearM[1]) * 12;
    termEvidence = snippet(t, termYearM.index ?? 0);
  }

  // 정기리스료 + 주기
  let paymentAmount: number | null = null;
  let paymentsPerYear: number | null = null;
  let payEvidence = "";
  const monthlyM = t.match(/(?:월\s*리스료|월\s*지급액|매월)\s*[:：]?\s*([0-9,]+)\s*원/);
  const annualM = t.match(/(?:연\s*리스료|연간\s*리스료|매년)\s*[:：]?\s*([0-9,]+)\s*원/);
  const quarterM = t.match(/(?:분기\s*리스료|매\s*분기)\s*[:：]?\s*([0-9,]+)\s*원/);
  if (monthlyM) {
    paymentAmount = parseAmount(monthlyM[1]);
    paymentsPerYear = 12;
    payEvidence = snippet(t, monthlyM.index ?? 0);
  } else if (quarterM) {
    paymentAmount = parseAmount(quarterM[1]);
    paymentsPerYear = 4;
    payEvidence = snippet(t, quarterM.index ?? 0);
  } else if (annualM) {
    paymentAmount = parseAmount(annualM[1]);
    paymentsPerYear = 1;
    payEvidence = snippet(t, annualM.index ?? 0);
  }

  // 지급시기 — '기초자산'의 '기초'와 충돌하지 않도록 지급 관련 표현만 사용
  const arrearsM = t.match(/(후급|매월\s*말|매\s*기말\s*지급|말일\s*지급|기말\s*지급)/);
  const advanceM = t.match(/(선급|선지급|매월\s*초|초일\s*지급|기초\s*지급)/);
  const timing: "advance" | "arrears" | null = arrearsM
    ? "arrears"
    : advanceM
      ? "advance"
      : null;

  // 할인율
  let rate: number | null = null;
  let rateEvidence = "";
  const rateM = t.match(
    /(?:할인율|증분차입이자율|내재이자율|IBR)\s*[:：]?\s*(?:연\s*)?([0-9.]+)\s*%/
  );
  if (rateM) {
    rate = Number(rateM[1]) / 100;
    rateEvidence = snippet(t, rateM.index ?? 0);
  }

  // 선택권/변동/복구
  const renewal = /연장\s*선택권|갱신\s*선택권|연장할\s*수\s*있다/.test(t);
  const purchase = /매수\s*선택권|소유권\s*이전|구매\s*선택권/.test(t);
  const variable = /변동\s*리스료|지수\s*연동|물가\s*연동|매출\s*연동|CPI/.test(t);
  const restoration = /복구\s*의무|원상\s*회복|철거\s*의무/.test(t);

  return {
    lessee: field(lesseeM?.[1]?.trim() ?? null, lesseeM ? 0.9 : 0, lesseeM ? snippet(t, lesseeM.index ?? 0) : "미발견"),
    lessor: field(lessorM?.[1]?.trim() ?? null, lessorM ? 0.9 : 0, lessorM ? snippet(t, lessorM.index ?? 0) : "미발견"),
    assetDescription: field(assetM?.[1]?.trim() ?? null, assetM ? 0.85 : 0, assetM ? snippet(t, assetM.index ?? 0) : "미발견"),
    commencementDate: field(commencement, dateM ? 0.92 : 0, dateM ? snippet(t, dateM.index ?? 0) : "미발견"),
    termMonths: field(termMonths, termMonths ? 0.9 : 0, termEvidence || "미발견"),
    paymentAmount: field(paymentAmount, paymentAmount ? 0.9 : 0, payEvidence || "미발견"),
    paymentsPerYear: field(paymentsPerYear, paymentsPerYear ? 0.95 : 0, payEvidence || "미발견"),
    paymentTiming: field(
      timing,
      timing ? 0.85 : 0.3,
      arrearsM
        ? snippet(t, arrearsM.index ?? 0)
        : advanceM
          ? snippet(t, advanceM.index ?? 0)
          : "명시 안됨 → 기본 후급 가정 검토 필요"
    ),
    annualDiscountRate: field(rate, rate ? 0.85 : 0, rateEvidence || "계약서 미명시 → IBR 별도 산정 필요"),
    renewalOption: field(renewal, 0.8, renewal ? "연장/갱신 선택권 조항 발견" : "조항 미발견"),
    purchaseOption: field(purchase, 0.8, purchase ? "매수선택권 조항 발견" : "조항 미발견"),
    variablePayment: field(variable, 0.8, variable ? "변동리스료 조항 발견" : "조항 미발견"),
    restorationObligation: field(restoration, 0.8, restoration ? "복구의무 조항 발견" : "조항 미발견"),
  };
}

/** 추출 결과 → 계산엔진 입력. 누락값은 안전 기본치로 채우되 confidence가 낮으면 UI에서 경고 */
export function toLeaseInput(e: ExtractedLease, id: string): LeaseInput {
  return {
    id,
    lessee: e.lessee.value ?? undefined,
    assetDescription: e.assetDescription.value ?? undefined,
    commencementDate: e.commencementDate.value ?? new Date().toISOString().slice(0, 10),
    termMonths: e.termMonths.value ?? 12,
    paymentAmount: e.paymentAmount.value ?? 0,
    paymentsPerYear: (e.paymentsPerYear.value as 1 | 2 | 4 | 12) ?? 12,
    paymentTiming: e.paymentTiming.value ?? "arrears",
    annualDiscountRate: e.annualDiscountRate.value ?? 0.05,
  };
}

/** LLM 추출용 시스템 프롬프트 (api/extract route에서 사용) */
export const EXTRACTION_PROMPT = `당신은 K-IFRS 1116(리스) 적용을 위해 리스 계약서를 분석하는 회계 전문가입니다.
주어진 계약서 텍스트에서 다음 필드를 추출해 JSON으로만 응답하세요. 각 필드는 {value, confidence(0~1), evidence(근거 조항 원문)} 형태입니다.
필드: lessee, lessor, assetDescription, commencementDate(YYYY-MM-DD), termMonths(정수), paymentAmount(숫자), paymentsPerYear(12|4|1), paymentTiming("advance"|"arrears"), annualDiscountRate(소수, 예 0.05), renewalOption(bool), purchaseOption(bool), variablePayment(bool), restorationObligation(bool).
계약서에 명시되지 않은 값은 value를 null, confidence를 0으로 두고 evidence에 "계약서 미명시"라고 적으세요. 추정하지 마세요. JSON 외 다른 텍스트는 출력하지 마세요.`;
