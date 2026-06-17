// IFRS 16 (K-IFRS 1116) lessee model — domain types.
// 모든 금액 단위는 입력 통화 기준(원). 날짜는 ISO(YYYY-MM-DD).

export type PaymentTiming = "advance" | "arrears"; // 선급(기초) / 후급(기말)
export type RateConvention = "effective" | "nominal"; // 기간이자율 환산 방식

export interface LeaseInput {
  /** 리스 식별자 */
  id: string;
  /** 리스이용자 / 자산 설명 (감사조서 표기용) */
  lessee?: string;
  assetDescription?: string;

  /** 리스개시일 */
  commencementDate: string;
  /** 리스기간 (개월). 연장/종료선택권 반영 후 '합리적 확실성' 기간 */
  termMonths: number;

  /** 1회 정기리스료 (고정) */
  paymentAmount: number;
  /** 연간 지급 횟수 (12=월, 4=분기, 1=연) */
  paymentsPerYear: 1 | 2 | 4 | 12;
  /** 선급/후급 */
  paymentTiming: PaymentTiming;

  /** 할인율 (연율, 소수. 예 0.05 = 5%). 내재이자율 또는 증분차입이자율(IBR) */
  annualDiscountRate: number;
  /** 할인율 환산 방식 (기본 effective) */
  rateConvention?: RateConvention;

  /** 사용권자산 조정 항목 */
  initialDirectCosts?: number; // 리스개설직접원가
  prepaidLeasePayments?: number; // 개시일 이전 선지급 리스료
  leaseIncentivesReceived?: number; // 수취한 리스 인센티브
  restorationCost?: number; // 복구원가 추정치(현재가치)

  /** 감가상각 내용연수(개월). 미입력 시 리스기간 사용 */
  usefulLifeMonths?: number;
}

export interface LiabilityPeriod {
  period: number; // 1..n
  date: string;
  opening: number; // 기초 리스부채
  interest: number; // 이자비용
  payment: number; // 리스료 지급
  principal: number; // 원금상환
  closing: number; // 기말 리스부채
}

export interface RouPeriod {
  period: number;
  date: string;
  opening: number;
  depreciation: number;
  closing: number;
}

export interface LeaseSchedule {
  input: LeaseInput;
  periodicRate: number; // 적용된 기간이자율
  initialLiability: number; // 개시일 리스부채(미지급 리스료의 PV)
  initialRouAsset: number; // 개시일 사용권자산
  periodsPerYear: number;
  totalPeriods: number;
  liabilitySchedule: LiabilityPeriod[];
  rouSchedule: RouPeriod[];
  totals: {
    totalPayments: number;
    totalInterest: number;
    totalDepreciation: number;
  };
}
