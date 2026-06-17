"use client";

import { useMemo, useState } from "react";
import { SAMPLES } from "@/lib/data/samples";
import {
  extractRuleBased,
  toLeaseInput,
} from "@/lib/extraction/extractor";
import type { ExtractedLease } from "@/lib/extraction/schema";
import { FIELD_LABELS } from "@/lib/extraction/schema";
import { buildSchedule, commencementJournalEntry, round } from "@/lib/ifrs16/engine";
import { recalc, runChecks, summarize, type Finding } from "@/lib/audit/checks";
import { buildWorkpaper } from "@/lib/audit/workpaper";

const won = (n: number) => `${round(n).toLocaleString()}원`;

function confColor(c: number) {
  if (c >= 0.85) return "bg-green-100 text-green-700";
  if (c >= 0.7) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}
function sevColor(s: Finding["severity"]) {
  return {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-sky-100 text-sky-700",
    info: "bg-green-100 text-green-700",
  }[s];
}

export default function Home() {
  const [text, setText] = useState(SAMPLES[0].text);
  const [activeSample, setActiveSample] = useState(SAMPLES[0].id);
  const [extracted, setExtracted] = useState<ExtractedLease | null>(null);
  const [useLLM, setUseLLM] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");

  const sample = SAMPLES.find((s) => s.id === activeSample);

  async function handleExtract() {
    setLoading(true);
    setNote("");
    if (useLLM) {
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const { extracted } = await res.json();
          setExtracted(extracted as ExtractedLease);
          setNote("LLM(Anthropic) 추출 결과");
          setLoading(false);
          return;
        }
        setNote("API 키 미설정 또는 오류 → 규칙기반으로 폴백");
      } catch {
        setNote("네트워크 오류 → 규칙기반으로 폴백");
      }
    }
    setExtracted(extractRuleBased(text));
    setLoading(false);
  }

  // 추출 결과 → 계산 → 검증 (메모이즈)
  const analysis = useMemo(() => {
    if (!extracted) return null;
    const input = toLeaseInput(extracted, sample?.id ?? "ADHOC");
    const schedule = buildSchedule(input);
    const rc = recalc(schedule, sample?.clientReportedLiability);
    const findings = runChecks(extracted, schedule, rc);
    const je = commencementJournalEntry(schedule);
    return { input, schedule, rc, findings, je };
  }, [extracted, sample]);

  function downloadWorkpaper() {
    if (!extracted || !analysis) return;
    const md = buildWorkpaper(
      extracted,
      analysis.schedule,
      analysis.findings,
      analysis.rc
    );
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workpaper_${analysis.input.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = analysis ? summarize(analysis.findings) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-brand-orange" />
          <span className="h-3 w-3 rounded-sm bg-brand-tangerine" />
          <span className="text-sm font-semibold tracking-wide text-neutral-500">
            LeaseLens
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-neutral-900">
          감사인 관점의 IFRS 16 리스 자동화·검증
        </h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          리스 계약서를 <b>AI로 추출(근거조항·신뢰도 포함)</b> → IFRS 16(K-IFRS 1116){" "}
          <b>독립 재계산</b> → <b>이상탐지·감사조서</b>까지. 단순 계산 자동화를 넘어,
          모든 수치가 계약 조항으로 <b>추적</b>되고 위험이 <b>플래그</b>되는 감사 워크플로우.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Left: input */}
        <section className="space-y-4">
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-neutral-500">
              1. 계약서 선택 / 붙여넣기
            </h2>
            <div className="mb-3 flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveSample(s.id);
                    setText(s.text);
                    setExtracted(null);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    activeSample === s.id
                      ? "border-brand-orange bg-orange-50 text-brand-orange"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>
            {sample && (
              <p className="mb-2 text-xs text-neutral-400">▸ {sample.note}</p>
            )}
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setExtracted(null);
              }}
              rows={12}
              className="w-full resize-none rounded-lg border border-neutral-200 p-3 font-mono text-xs leading-relaxed focus:border-brand-orange focus:outline-none"
            />
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={useLLM}
                  onChange={(e) => setUseLLM(e.target.checked)}
                />
                LLM 추출 사용 (서버 ANTHROPIC_API_KEY 필요, 없으면 규칙기반)
              </label>
              <button
                onClick={handleExtract}
                disabled={loading}
                className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "추출 중…" : "추출 → 분석"}
              </button>
            </div>
            {note && <p className="mt-2 text-xs text-neutral-400">{note}</p>}
          </div>
        </section>

        {/* Right: results */}
        <section className="space-y-6">
          {!extracted && (
            <div className="card flex h-full items-center justify-center text-center text-sm text-neutral-400">
              계약서를 선택하고 <b className="mx-1">추출 → 분석</b> 을 눌러보세요.
            </div>
          )}

          {extracted && analysis && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <KPI label="개시 리스부채" value={won(analysis.schedule.initialLiability)} />
                <KPI label="사용권자산" value={won(analysis.schedule.initialRouAsset)} />
                <KPI
                  label="위험 플래그"
                  value={`${counts!.high} / ${counts!.medium} / ${counts!.low}`}
                  sub="High / Med / Low"
                />
              </div>

              {/* Extraction table */}
              <div className="card">
                <h2 className="mb-3 text-sm font-semibold text-neutral-500">
                  2. 추출 데이터 · 근거 추적성
                </h2>
                <div className="overflow-hidden rounded-lg border border-neutral-100">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-50 text-neutral-500">
                      <tr>
                        <th className="p-2 text-left">항목</th>
                        <th className="p-2 text-left">값</th>
                        <th className="p-2 text-left">신뢰도</th>
                        <th className="p-2 text-left">근거</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(FIELD_LABELS) as (keyof ExtractedLease)[]).map(
                        (k) => {
                          const fld = extracted[k];
                          return (
                            <tr key={k} className="border-t border-neutral-100">
                              <td className="p-2 text-neutral-500">
                                {FIELD_LABELS[k]}
                              </td>
                              <td className="p-2 font-medium text-neutral-800">
                                {fld.value === null ? (
                                  <span className="text-red-500">미추출</span>
                                ) : (
                                  String(fld.value)
                                )}
                              </td>
                              <td className="p-2">
                                <span
                                  className={`badge ${confColor(fld.confidence)}`}
                                >
                                  {(fld.confidence * 100).toFixed(0)}%
                                </span>
                              </td>
                              <td className="p-2 text-neutral-400">
                                {fld.evidence}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recalc */}
              <div className="card">
                <h2 className="mb-3 text-sm font-semibold text-neutral-500">
                  3. 독립 재계산 검증
                </h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Row label="적용 기간이자율">
                    {(analysis.schedule.periodicRate * 100).toFixed(4)}% / 기간
                  </Row>
                  <Row label="엔진 리스부채">
                    {won(analysis.rc.engineLiability)}
                  </Row>
                  {analysis.rc.clientLiability != null ? (
                    <>
                      <Row label="회사 제시 리스부채">
                        {won(analysis.rc.clientLiability)}
                      </Row>
                      <Row label="차이">
                        <span
                          className={
                            analysis.rc.pass ? "text-green-600" : "text-red-600"
                          }
                        >
                          {won(analysis.rc.difference!)} (
                          {(analysis.rc.differencePct! * 100).toFixed(2)}%){" "}
                          {analysis.rc.pass ? "PASS" : "FAIL"}
                        </span>
                      </Row>
                    </>
                  ) : (
                    <Row label="회사 제시 수치">없음 (비교 생략)</Row>
                  )}
                </div>
              </div>

              {/* Findings */}
              <div className="card">
                <h2 className="mb-3 text-sm font-semibold text-neutral-500">
                  4. 위험 플래그 / 발견사항
                </h2>
                <div className="space-y-2">
                  {analysis.findings.map((f, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-neutral-100 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`badge ${sevColor(f.severity)}`}>
                          {f.severity.toUpperCase()}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {f.category}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-neutral-800">{f.message}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        ▸ {f.recommendation}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Schedule preview + JE + export */}
              <div className="card">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-500">
                    5. 상각표 & 개시 분개
                  </h2>
                  <button
                    onClick={downloadWorkpaper}
                    className="rounded-lg border border-brand-orange px-3 py-1.5 text-xs font-semibold text-brand-orange hover:bg-orange-50"
                  >
                    감사조서 내보내기 (.md)
                  </button>
                </div>
                <div className="mb-4 max-h-48 overflow-auto rounded-lg border border-neutral-100">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
                      <tr>
                        <th className="p-2 text-left">기</th>
                        <th className="p-2 text-right">기초부채</th>
                        <th className="p-2 text-right">이자</th>
                        <th className="p-2 text-right">지급</th>
                        <th className="p-2 text-right">기말부채</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.schedule.liabilitySchedule.map((p) => (
                        <tr key={p.period} className="border-t border-neutral-100">
                          <td className="p-2">{p.period}</td>
                          <td className="p-2 text-right">{round(p.opening).toLocaleString()}</td>
                          <td className="p-2 text-right">{round(p.interest).toLocaleString()}</td>
                          <td className="p-2 text-right">{round(p.payment).toLocaleString()}</td>
                          <td className="p-2 text-right">{round(p.closing).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg bg-neutral-50 p-3 text-xs">
                  <p className="mb-1 font-semibold text-neutral-500">개시일 분개</p>
                  {analysis.je.debit.map((d, i) => (
                    <p key={i}>(차) {d.account} {d.amount.toLocaleString()}</p>
                  ))}
                  {analysis.je.credit.map((c, i) => (
                    <p key={i} className="pl-6">(대) {c.account} {c.amount.toLocaleString()}</p>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-400">
        <p>
          LeaseLens · K-IFRS 1116 리스이용자 모형 · 계산엔진은 단위테스트로 검증됨
          (npm test). 본 도구는 감사 보조용이며 전문가의 검토를 대체하지 않습니다.
        </p>
      </footer>
    </main>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-neutral-900">{value}</p>
      {sub && <p className="text-[10px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg bg-neutral-50 p-3">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="mt-0.5 font-medium text-neutral-800">{children}</span>
    </div>
  );
}
