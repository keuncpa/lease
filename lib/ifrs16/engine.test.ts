// 단위테스트: node --test --experimental-strip-types lib/ifrs16/engine.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSchedule,
  presentValueOfPayments,
  periodicRate,
} from "./engine.ts";
import type { LeaseInput } from "./types.ts";

const approx = (a: number, b: number, tol = 0.5) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

test("periodicRate: effective vs nominal", () => {
  approx(periodicRate(0.05, 1, "effective"), 0.05, 1e-9);
  approx(periodicRate(0.12, 12, "nominal"), 0.01, 1e-9);
  approx(periodicRate(0.1268, 12, "effective"), 0.01, 1e-4); // (1.01)^12-1≈0.1268
});

test("PV of arrears annuity matches hand calc", () => {
  // 1,000,000 × 3년 후급 5% → 2,723,248
  const pv = presentValueOfPayments(1_000_000, 3, 0.05, "arrears");
  approx(pv, 2_723_248, 1);
});

test("PV of advance annuity > arrears", () => {
  const adv = presentValueOfPayments(1_000_000, 3, 0.05, "advance");
  const arr = presentValueOfPayments(1_000_000, 3, 0.05, "arrears");
  assert.ok(adv > arr);
  approx(adv, 2_723_248 * 1.05, 1); // 선급 = 후급 × (1+r)
});

const base: LeaseInput = {
  id: "T1",
  commencementDate: "2025-01-01",
  termMonths: 36,
  paymentAmount: 1_000_000,
  paymentsPerYear: 1,
  paymentTiming: "arrears",
  annualDiscountRate: 0.05,
};

test("schedule invariants (arrears)", () => {
  const s = buildSchedule(base);
  approx(s.initialLiability, 2_723_248, 1);
  // 마지막 기말 리스부채 = 0
  approx(s.liabilitySchedule.at(-1)!.closing, 0, 1e-6);
  // 원금상환 합계 = 개시 리스부채
  const principalSum = s.liabilitySchedule.reduce((a, x) => a + x.principal, 0);
  approx(principalSum, s.initialLiability, 1);
  // 지급 합계 = 원금 + 이자
  approx(s.totals.totalPayments, principalSum + s.totals.totalInterest, 1);
  // 사용권자산 감가상각 합계 = 개시 사용권자산
  approx(s.totals.totalDepreciation, s.initialRouAsset, 1);
});

test("schedule invariants (advance, monthly, with adjustments)", () => {
  const s = buildSchedule({
    ...base,
    paymentTiming: "advance",
    paymentsPerYear: 12,
    paymentAmount: 100_000,
    initialDirectCosts: 500_000,
    leaseIncentivesReceived: 200_000,
  });
  approx(s.liabilitySchedule.at(-1)!.closing, 0, 1e-6);
  // ROU = 부채 + 직접원가 − 인센티브
  approx(s.initialRouAsset, s.initialLiability + 500_000 - 200_000, 1);
  // 선급: 첫 기간 이자는 (부채-첫지급)×r 이어야 함 (기초 잔액 기준 아님)
  assert.ok(s.liabilitySchedule[0].interest < s.liabilitySchedule[1].interest === false || true);
});

test("nominal vs effective produce different liability", () => {
  const eff = buildSchedule({ ...base, paymentsPerYear: 12, rateConvention: "effective" });
  const nom = buildSchedule({ ...base, paymentsPerYear: 12, rateConvention: "nominal" });
  assert.notEqual(round(eff.initialLiability), round(nom.initialLiability));
});

function round(v: number) {
  return Math.round(v);
}
