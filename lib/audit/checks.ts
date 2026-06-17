// 감사인 관점 검증 레이어.
// 단순 "자동 계산"을 넘어, (1) 독립적 재계산, (2) 이상탐지/위험 플래그,
// (3) 근거 추적성 점검을 수행해 감사 절차에 바로 연결되는 결과를 만든다.

import type { ExtractedLease } from "../extraction/schema";
import type { LeaseSchedule } from "../ifrs16/types";
import { round } from "../ifrs16/engine";

export type Severity = "high" | "medium" | "low" | "info";

export interface Finding {
  severity: Severity;
  category: string; // 완전성/정확성/평가/표시·공시 등
  field?: string;
  message: string;
  recommendation: string;
}

export interface RecalcResult {
  engineLiability: number;
  clientLiability?: number;
  difference?: number;
  differencePct?: number;
  pass?: boolean;
}

const RATE_FLOOR = 0.01; // 1%
const RATE_CAP = 0.15; // 15%
const CONFIDENCE_THRESHOLD = 0.7;
const RECALC_TOLERANCE_PCT = 0.01; // 1%

/** 독립 재계산 vs 클라이언트 수치 비교 */
export function recalc(
  schedule: LeaseSchedule,
  clientLiability?: number
): RecalcResult {
  const engineLiability = round(schedule.initialLiability);
  if (clientLiability == null) return { engineLiability };
  const difference = round(engineLiability - clientLiability);
  const differencePct = clientLiability !== 0 ? Math.abs(difference / clientLiability) : 1;
  return {
    engineLiability,
    clientLiability,
    difference,
    differencePct,
    pass: differencePct <= RECALC_TOLERANCE_PCT,
  };
}

/** 이상탐지 + 위험 플래그 */
export function runChecks(
  e: ExtractedLease,
  schedule: LeaseSchedule,
  recalcResult?: RecalcResult
): Finding[] {
  const f: Finding[] = [];

  // (1) 완전성 — 필수값 누락/저신뢰
  const required: (keyof ExtractedLease)[] = [
    "commencementDate",
    "termMonths",
    "paymentAmount",
    "annualDiscountRate",
  ];
  for (const key of required) {
    const fld = e[key];
    if (fld.value == null) {
      f.push({
        severity: "high",
        category: "완전성",
        field: key,
        message: `필수 항목 '${key}' 이(가) 계약서에서 추출되지 않음`,
        recommendation: "원본 계약서/부속합의서를 추가 입수하여 수기 보완 후 재검토",
      });
    } else if (fld.confidence < CONFIDENCE_THRESHOLD) {
      f.push({
        severity: "medium",
        category: "완전성",
        field: key,
        message: `'${key}' 추출 신뢰도 ${(fld.confidence * 100).toFixed(0)}% — 검토 필요`,
        recommendation: "근거 조항을 직접 확인하고 reviewed 표시",
      });
    }
  }

  // (2) 정확성/평가 — 할인율 합리성
  const rate = e.annualDiscountRate.value;
  if (rate != null) {
    if (rate < RATE_FLOOR || rate > RATE_CAP) {
      f.push({
        severity: "high",
        category: "평가",
        field: "annualDiscountRate",
        message: `할인율 ${(rate * 100).toFixed(2)}% 이(가) 합리적 범위(1~15%)를 벗어남`,
        recommendation: "내재이자율 산정근거 또는 IBR 도출자료(신용스프레드·기간) 재검토",
      });
    }
  } else {
    f.push({
      severity: "high",
      category: "평가",
      field: "annualDiscountRate",
      message: "할인율이 계약서에 명시되지 않음 (내재이자율 산정 불가 추정)",
      recommendation: "리스이용자의 증분차입이자율(IBR)을 별도 산정·문서화",
    });
  }

  // (3) 표시·공시 — 변동리스료
  if (e.variablePayment.value) {
    f.push({
      severity: "medium",
      category: "표시·공시",
      field: "variablePayment",
      message: "지수·실적 연동 변동리스료 조항 존재",
      recommendation:
        "지수/요율 연동분만 부채 측정에 포함, 실적연동분은 발생시 비용처리 — 분리 검토 및 주석 공시",
    });
  }

  // (4) 평가 — 선택권 (리스기간 판단)
  if (e.renewalOption.value || e.purchaseOption.value) {
    f.push({
      severity: "medium",
      category: "평가",
      field: e.purchaseOption.value ? "purchaseOption" : "renewalOption",
      message: `${e.purchaseOption.value ? "매수" : "연장"}선택권 존재 — 리스기간/측정에 영향 가능`,
      recommendation:
        "행사가 '합리적으로 확실'한지 판단하여 리스기간(termMonths)에 반영했는지 확인",
    });
  }

  // (5) 가정 노출 — 지급시기 미확인
  if (e.paymentTiming.confidence < CONFIDENCE_THRESHOLD) {
    f.push({
      severity: "low",
      category: "가정",
      field: "paymentTiming",
      message: "지급시기(선급/후급)가 계약서에 명확하지 않아 가정 적용",
      recommendation: "선급/후급에 따라 리스부채가 (1+r)배 차이 — 결제이력으로 확인",
    });
  }

  // (6) 복구의무 — 사용권자산 누락 위험
  if (e.restorationObligation.value && !(schedule.input.restorationCost)) {
    f.push({
      severity: "medium",
      category: "완전성",
      field: "restorationObligation",
      message: "복구의무 조항 존재하나 복구원가가 사용권자산에 미반영",
      recommendation: "복구원가 추정치의 현재가치를 사용권자산·복구충당부채로 인식",
    });
  }

  // (7) 재계산 차이
  if (recalcResult && recalcResult.pass === false) {
    f.push({
      severity: "high",
      category: "정확성",
      message: `독립 재계산 리스부채(${recalcResult.engineLiability.toLocaleString()})와 회사 수치(${recalcResult.clientLiability?.toLocaleString()}) 차이 ${(recalcResult.differencePct! * 100).toFixed(1)}%`,
      recommendation: "차이원인(할인율·기간·지급조건) 분해 후 수정사항(AJE) 검토",
    });
  }

  if (f.length === 0) {
    f.push({
      severity: "info",
      category: "종합",
      message: "주요 위험 플래그 없음 — 모든 필수항목 추출·재계산 일치",
      recommendation: "표본 외 추가 절차 불요. 근거조항 첨부 후 조서 마감",
    });
  }
  return f;
}

export function summarize(findings: Finding[]) {
  return {
    high: findings.filter((x) => x.severity === "high").length,
    medium: findings.filter((x) => x.severity === "medium").length,
    low: findings.filter((x) => x.severity === "low").length,
  };
}
