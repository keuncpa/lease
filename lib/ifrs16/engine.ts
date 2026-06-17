// IFRS 16 / K-IFRS 1116 리스이용자 회계 계산 엔진
// 설계 원칙: (1) 결정론적·재현가능, (2) 모든 중간값 노출(감사 재계산용),
// (3) 반올림 정책 명시. 외부 의존성 없음 — 단위테스트로 검증.

import type {
  LeaseInput,
  LeaseSchedule,
  LiabilityPeriod,
  RouPeriod,
} from "./types";

/** 표시용 반올림(원 단위, 0자리). 내부 계산은 풀 정밀도로 누적 후 표기시에만 반올림. */
export function round(value: number, digits = 0): number {
  const f = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * 연 할인율 → 기간 할인율 환산.
 * - effective(기본): (1+r)^(1/m) - 1  → (1+연율) 복리와 정합
 * - nominal: r/m            → 명목 분할 (일부 실무 시스템 관행)
 */
export function periodicRate(
  annualRate: number,
  paymentsPerYear: number,
  convention: "effective" | "nominal" = "effective"
): number {
  if (convention === "nominal") return annualRate / paymentsPerYear;
  return Math.pow(1 + annualRate, 1 / paymentsPerYear) - 1;
}

/** 개월 수 → 기간 수. (예: 36개월, 분기지급 → 12기간) */
function monthsToPeriods(months: number, paymentsPerYear: number): number {
  const monthsPerPeriod = 12 / paymentsPerYear;
  return Math.round(months / monthsPerPeriod);
}

/** 개시일 기준 기간 t의 지급/측정일 계산 */
function addPeriods(
  commencement: string,
  periodIndex: number,
  paymentsPerYear: number
): string {
  const monthsPerPeriod = 12 / paymentsPerYear;
  const d = new Date(commencement + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + Math.round(periodIndex * monthsPerPeriod));
  return d.toISOString().slice(0, 10);
}

/**
 * 미지급 정기리스료의 현재가치 = 개시일 리스부채.
 * advance(선급): 첫 지급이 t=0 → 할인 안 함.
 * arrears(후급): 첫 지급이 t=1.
 */
export function presentValueOfPayments(
  payment: number,
  periods: number,
  rate: number,
  timing: "advance" | "arrears"
): number {
  let pv = 0;
  for (let i = 1; i <= periods; i++) {
    const t = timing === "advance" ? i - 1 : i;
    pv += payment / Math.pow(1 + rate, t);
  }
  return pv;
}

/**
 * 리스 전체 스케줄 산출 (리스부채 + 사용권자산).
 * 마지막 기간 리스부채 closing은 누적 반올림 오차를 흡수하여 정확히 0이 되도록 조정.
 */
export function buildSchedule(input: LeaseInput): LeaseSchedule {
  const convention = input.rateConvention ?? "effective";
  const ppy = input.paymentsPerYear;
  const totalPeriods = monthsToPeriods(input.termMonths, ppy);
  const r = periodicRate(input.annualDiscountRate, ppy, convention);

  const initialLiability = presentValueOfPayments(
    input.paymentAmount,
    totalPeriods,
    r,
    input.paymentTiming
  );

  // 사용권자산 = 리스부채 + 직접원가 + 선급리스료 + 복구원가 − 인센티브
  const initialRouAsset =
    initialLiability +
    (input.initialDirectCosts ?? 0) +
    (input.prepaidLeasePayments ?? 0) +
    (input.restorationCost ?? 0) -
    (input.leaseIncentivesReceived ?? 0);

  // ---- 리스부채 스케줄 (유효이자율법) ----
  const liabilitySchedule: LiabilityPeriod[] = [];
  let opening = initialLiability;
  for (let p = 1; p <= totalPeriods; p++) {
    let interest: number;
    let payment = input.paymentAmount;

    if (input.paymentTiming === "advance") {
      // 기초지급: 먼저 원금상환 후 잔액에 이자
      const afterPayment = opening - payment;
      interest = afterPayment * r;
    } else {
      // 기말지급: 기초잔액에 이자 후 지급
      interest = opening * r;
    }

    let principal = payment - interest;
    let closing = opening + interest - payment;

    // 마지막 기간: 잔액 0 강제(누적오차 흡수)
    if (p === totalPeriods) {
      payment = opening + interest;
      principal = payment - interest;
      closing = 0;
    }

    liabilitySchedule.push({
      period: p,
      date: addPeriods(
        input.commencementDate,
        input.paymentTiming === "advance" ? p - 1 : p,
        ppy
      ),
      opening,
      interest,
      payment,
      principal,
      closing,
    });
    opening = closing;
  }

  // ---- 사용권자산 정액 감가상각 ----
  const lifeMonths = input.usefulLifeMonths ?? input.termMonths;
  const depPeriods = monthsToPeriods(lifeMonths, ppy);
  const depPerPeriod = initialRouAsset / depPeriods;

  const rouSchedule: RouPeriod[] = [];
  let rouOpening = initialRouAsset;
  for (let p = 1; p <= totalPeriods; p++) {
    let dep = p <= depPeriods ? depPerPeriod : 0;
    let closing = rouOpening - dep;
    if (p === depPeriods) {
      dep = rouOpening; // 마지막 상각기 잔액 정리
      closing = 0;
    }
    rouSchedule.push({
      period: p,
      date: addPeriods(input.commencementDate, p, ppy),
      opening: rouOpening,
      depreciation: dep,
      closing,
    });
    rouOpening = closing;
  }

  const totals = {
    totalPayments: liabilitySchedule.reduce((s, x) => s + x.payment, 0),
    totalInterest: liabilitySchedule.reduce((s, x) => s + x.interest, 0),
    totalDepreciation: rouSchedule.reduce((s, x) => s + x.depreciation, 0),
  };

  return {
    input,
    periodicRate: r,
    initialLiability,
    initialRouAsset,
    periodsPerYear: ppy,
    totalPeriods,
    liabilitySchedule,
    rouSchedule,
    totals,
  };
}

/** 개시일 분개 (차변/대변) */
export function commencementJournalEntry(schedule: LeaseSchedule) {
  const { input, initialLiability, initialRouAsset } = schedule;
  const idc = input.initialDirectCosts ?? 0;
  const prepaid = input.prepaidLeasePayments ?? 0;
  const incentive = input.leaseIncentivesReceived ?? 0;
  const restoration = input.restorationCost ?? 0;
  return {
    debit: [
      { account: "사용권자산", amount: round(initialRouAsset) },
    ],
    credit: [
      { account: "리스부채", amount: round(initialLiability) },
      ...(idc ? [{ account: "현금(리스개설직접원가)", amount: round(idc) }] : []),
      ...(prepaid ? [{ account: "선급리스료 대체", amount: round(prepaid) }] : []),
      ...(restoration ? [{ account: "복구충당부채", amount: round(restoration) }] : []),
      ...(incentive ? [{ account: "(차감)리스인센티브", amount: round(-incentive) }] : []),
    ],
  };
}
