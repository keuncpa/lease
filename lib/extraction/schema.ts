// 계약서 추출 결과 스키마.
// 핵심 차별점: 모든 필드가 (값 + 신뢰도 + 근거조항)을 함께 보유 → 감사 추적성.

export interface ExtractedField<T> {
  value: T | null;
  /** 0~1. 모델/규칙이 추정한 추출 신뢰도 */
  confidence: number;
  /** 근거가 된 계약 조항 원문 (페이지/조문) */
  evidence: string;
  /** 사람이 검토·수정했는지 (감사인 review 표시) */
  reviewed?: boolean;
}

export interface ExtractedLease {
  lessee: ExtractedField<string>;
  lessor: ExtractedField<string>;
  assetDescription: ExtractedField<string>;
  commencementDate: ExtractedField<string>; // YYYY-MM-DD
  termMonths: ExtractedField<number>;
  paymentAmount: ExtractedField<number>;
  paymentsPerYear: ExtractedField<number>; // 12/4/1
  paymentTiming: ExtractedField<"advance" | "arrears">;
  annualDiscountRate: ExtractedField<number>; // 소수
  /** 연장선택권 존재 여부 (있으면 리스기간 판단에 영향) */
  renewalOption: ExtractedField<boolean>;
  /** 매수선택권 존재 여부 */
  purchaseOption: ExtractedField<boolean>;
  /** 변동리스료 조항 존재 여부 (지수/실적 연동) */
  variablePayment: ExtractedField<boolean>;
  /** 복구의무 존재 여부 */
  restorationObligation: ExtractedField<boolean>;
}

export const FIELD_LABELS: Record<keyof ExtractedLease, string> = {
  lessee: "리스이용자",
  lessor: "리스제공자",
  assetDescription: "기초자산",
  commencementDate: "리스개시일",
  termMonths: "리스기간(개월)",
  paymentAmount: "정기리스료",
  paymentsPerYear: "연 지급횟수",
  paymentTiming: "지급시기(선급/후급)",
  annualDiscountRate: "할인율(연)",
  renewalOption: "연장선택권",
  purchaseOption: "매수선택권",
  variablePayment: "변동리스료",
  restorationObligation: "복구의무",
};
