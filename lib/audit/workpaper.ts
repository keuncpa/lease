// 감사조서(workpaper) 생성 — 추출·재계산·검증 결과를 추적가능한 문서로.
import type { ExtractedLease } from "../extraction/schema";
import { FIELD_LABELS } from "../extraction/schema";
import type { LeaseSchedule } from "../ifrs16/types";
import { round } from "../ifrs16/engine";
import type { Finding, RecalcResult } from "./checks";

export function buildWorkpaper(
  extracted: ExtractedLease,
  schedule: LeaseSchedule,
  findings: Finding[],
  recalc: RecalcResult,
  preparer = "LeaseLens (자동생성)"
): string {
  const now = new Date().toISOString().slice(0, 10);
  const i = schedule.input;
  const lines: string[] = [];

  lines.push(`# 리스 감사조서 — ${i.lessee ?? "(리스이용자 미상)"}`);
  lines.push("");
  lines.push(`- 조서번호: LEASE-${i.id}`);
  lines.push(`- 작성: ${preparer}  |  작성일: ${now}`);
  lines.push(`- 기초자산: ${i.assetDescription ?? "-"}`);
  lines.push(`- 적용기준: K-IFRS 제1116호 (리스이용자 단일모형)`);
  lines.push("");

  lines.push(`## 1. 추출 데이터 및 근거 추적`);
  lines.push("");
  lines.push(`| 항목 | 값 | 신뢰도 | 근거조항 |`);
  lines.push(`|---|---|---|---|`);
  (Object.keys(FIELD_LABELS) as (keyof ExtractedLease)[]).forEach((k) => {
    const f = extracted[k];
    const v = f.value === null ? "—" : String(f.value);
    lines.push(
      `| ${FIELD_LABELS[k]} | ${v} | ${(f.confidence * 100).toFixed(0)}% | ${f.evidence} |`
    );
  });
  lines.push("");

  lines.push(`## 2. 독립 재계산 (IFRS 16)`);
  lines.push("");
  lines.push(`- 적용 기간이자율: ${(schedule.periodicRate * 100).toFixed(4)}% / 기간`);
  lines.push(`- 엔진 산출 개시 리스부채: ${round(schedule.initialLiability).toLocaleString()}원`);
  lines.push(`- 개시 사용권자산: ${round(schedule.initialRouAsset).toLocaleString()}원`);
  if (recalc.clientLiability != null) {
    lines.push(`- 회사 제시 리스부채: ${recalc.clientLiability.toLocaleString()}원`);
    lines.push(
      `- 차이: ${recalc.difference!.toLocaleString()}원 (${(recalc.differencePct! * 100).toFixed(2)}%) → ${recalc.pass ? "허용오차 이내(PASS)" : "조사 필요(FAIL)"}`
    );
  }
  lines.push(
    `- 총 이자비용: ${round(schedule.totals.totalInterest).toLocaleString()}원 / 총 감가상각: ${round(schedule.totals.totalDepreciation).toLocaleString()}원`
  );
  lines.push("");

  lines.push(`## 3. 위험 플래그 / 발견사항`);
  lines.push("");
  lines.push(`| 심각도 | 분류 | 내용 | 권고 절차 |`);
  lines.push(`|---|---|---|---|`);
  findings.forEach((f) => {
    lines.push(`| ${f.severity.toUpperCase()} | ${f.category} | ${f.message} | ${f.recommendation} |`);
  });
  lines.push("");

  lines.push(`## 4. 상각표 (요약)`);
  lines.push("");
  lines.push(`| 기 | 일자 | 기초부채 | 이자 | 지급 | 기말부채 |`);
  lines.push(`|---|---|---|---|---|---|`);
  schedule.liabilitySchedule.slice(0, 12).forEach((p) => {
    lines.push(
      `| ${p.period} | ${p.date} | ${round(p.opening).toLocaleString()} | ${round(p.interest).toLocaleString()} | ${round(p.payment).toLocaleString()} | ${round(p.closing).toLocaleString()} |`
    );
  });
  if (schedule.liabilitySchedule.length > 12)
    lines.push(`| ... | (총 ${schedule.totalPeriods}기) | | | | |`);
  lines.push("");
  lines.push(`> 본 조서는 LeaseLens가 자동 생성했으며, 모든 수치는 위 근거조항으로 추적 가능합니다. 감사인의 검토·서명으로 최종화됩니다.`);

  return lines.join("\n");
}
