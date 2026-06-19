"use client";

import { useMemo, useRef, useState } from "react";
import { SAMPLES } from "@/lib/data/samples";
import {
  extractRuleBased,
  toLeaseInput,
  coerceExtracted,
} from "@/lib/extraction/extractor";
import type { RateConvention } from "@/lib/ifrs16/types";
import type { ExtractedLease } from "@/lib/extraction/schema";
import { FIELD_LABELS } from "@/lib/extraction/schema";
import { buildSchedule, commencementJournalEntry, round } from "@/lib/ifrs16/engine";
import { recalc, runChecks, summarize, type Finding } from "@/lib/audit/checks";
import { buildWorkpaper } from "@/lib/audit/workpaper";
import { parsePdf, ocrPdf, type PdfParseResponse } from "@/lib/extraction/pdf";

const won = (n: number) => `${round(n).toLocaleString()}원`;

function confColor(c: number) {
  if (c >= 0.85) return "bg-emerald-100 text-emerald-700";
  if (c >= 0.7) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}
function sevColor(s: Finding["severity"]) {
  return {
    high: "bg-rose-100 text-rose-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-sky-100 text-sky-700",
    info: "bg-emerald-100 text-emerald-700",
  }[s];
}

type Source = { kind: "pdf" | "sample" | "manual"; label: string };

const HOW_STEPS = [
  {
    title: "계약서 입력",
    desc: "PDF 업로드 또는 예시 선택. 스캔본은 자동 OCR.",
  },
  {
    title: "AI 항목 추출",
    desc: "개시일·기간·리스료·할인율을 근거 조항·신뢰도와 함께 추출.",
  },
  {
    title: "독립 재계산 · 검증",
    desc: "IFRS 16 재계산으로 회사 수치 비교, 위험 등급화, 감사조서 출력.",
  },
];

export default function Home() {
  const [text, setText] = useState("");
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedLease | null>(null);
  const [useLLM, setUseLLM] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [convention, setConvention] = useState<RateConvention>("effective");
  const [pdf, setPdf] = useState<PdfParseResponse | null>(null);
  const [pdfBusy, setPdfBusy] = useState("");
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sample = activeSample
    ? SAMPLES.find((s) => s.id === activeSample)
    : undefined;
  const hasInput = text.trim().length > 0;

  function clearAll() {
    setText("");
    setActiveSample(null);
    setExtracted(null);
    setPdf(null);
    setOcrFile(null);
    setSource(null);
    setNote("");
  }

  async function handlePdf(file: File) {
    if (file.type && !file.type.includes("pdf")) {
      setNote("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    setPdfBusy("PDF 텍스트 추출 중…");
    setNote("");
    setExtracted(null);
    setPdf(null);
    setOcrFile(null);
    setActiveSample(null);
    try {
      const res = await parsePdf(file);
      setText(res.text);
      setPdf(res);
      setSource({ kind: "pdf", label: res.fileName });
      if (res.scanned) {
        setOcrFile(file);
        setNote(
          `스캔본 가능성 (페이지당 ${res.charsPerPage}자) — 텍스트 레이어가 거의 없습니다. 아래 OCR을 실행하세요.`
        );
      } else {
        setNote(`PDF 추출 완료 · ${res.pages}p · ${res.charCount}자`);
      }
    } catch (e) {
      setNote(`PDF 추출 실패: ${String(e)}`);
    } finally {
      setPdfBusy("");
    }
  }

  async function handleOcr() {
    if (!ocrFile) return;
    setPdfBusy("OCR 준비 중… (한/영 언어팩 최초 1회 다운로드)");
    try {
      const out = await ocrPdf(ocrFile, ({ page, pages, ratio }) =>
        setPdfBusy(`OCR 인식 중… ${page}/${pages}p (${Math.round(ratio * 100)}%)`)
      );
      setText(out);
      setExtracted(null);
      setNote(
        `OCR 완료 · ${out.replace(/\s/g, "").length}자 인식 (감사 시 원본 대조 권고)`
      );
      setOcrFile(null);
    } catch (e) {
      setNote(`OCR 실패: ${String(e)}`);
    } finally {
      setPdfBusy("");
    }
  }

  function loadSample(s: (typeof SAMPLES)[number]) {
    setActiveSample(s.id);
    setText(s.text);
    setPdf(null);
    setOcrFile(null);
    setSource({ kind: "sample", label: s.title });
    setNote("");
    // 원클릭 체험: 예시를 누르면 추출·분석까지 즉시 실행(규칙기반).
    setExtracted(extractRuleBased(s.text));
    setUseLLM(false);
  }

  function onTextChange(v: string) {
    setText(v);
    setExtracted(null);
    if (v.trim().length === 0) {
      setSource(null);
      setActiveSample(null);
    } else if (!source) {
      setSource({ kind: "manual", label: "직접 입력한 계약서" });
    }
  }

  async function handleExtract() {
    if (!hasInput) return;
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
          setExtracted(coerceExtracted(extracted));
          setNote("LLM 추출 결과 (스키마 검증 적용)");
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

  const analysis = useMemo(() => {
    if (!extracted) return null;
    const input = toLeaseInput(extracted, sample?.id ?? "ADHOC", convention);
    const schedule = buildSchedule(input);
    const rc = recalc(schedule, sample?.clientReportedLiability);
    const findings = runChecks(extracted, schedule, rc);
    const je = commencementJournalEntry(schedule);
    return { input, schedule, rc, findings, je };
  }, [extracted, sample, convention]);

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
    <main className="min-h-screen">
      {/* ===== Hero ===== */}
      <header className="relative overflow-hidden bg-brand-navy text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 120% at 100% 0%, rgba(20,184,166,0.28) 0%, rgba(11,37,69,0) 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-10">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="text-sm font-bold tracking-wide">LeaseLens</span>
            <span className="ml-2 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-teal-200">
              감사 보조 도구
            </span>
          </div>
          <h1 className="mt-5 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">
            리스 계약서에서 IFRS 16 회계처리까지,
            <span className="text-brand-tealLight"> 자동 추출 · 독립 재계산 · 검증</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300">
            AI가 계약 조건을 추출하고, K-IFRS 1116으로 리스부채·사용권자산을 독립
            재계산해 회사 수치와의 차이와 회계 위험을 식별합니다.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <button
              onClick={() => {
                loadSample(SAMPLES[0]);
                setTimeout(
                  () =>
                    document
                      .getElementById("workspace")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  60
                );
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-tealLight px-5 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition hover:brightness-105"
            >
              예시 계약서로 바로 보기
            </button>
            <span className="text-xs text-slate-400">또는 PDF 직접 업로드</span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {["계약서 AI 추출", "IFRS 16 독립 재계산", "이상탐지·위험 플래그", "감사조서 자동생성"].map(
              (s, i) => (
                <span key={s} className="flex items-center gap-2">
                  {i > 0 && <span className="text-teal-300/50">›</span>}
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200">
                    {s}
                  </span>
                </span>
              )
            )}
          </div>
          <p className="mt-4 text-[11px] text-slate-400">
            Next.js · TypeScript · GenAI/오픈소스 LLM 멀티 프로바이더 · pdfjs 추출 ·
            tesseract.js OCR · 계산엔진 단위테스트 검증
          </p>
        </div>
      </header>

      {/* ===== 작동 방식 3단계 (콜드 방문자 안내) ===== */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
작동 방식 · 3단계
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {HOW_STEPS.map((s, i) => (
              <div
                key={s.title}
                className="relative flex gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-navy text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {s.desc}
                  </p>
                </div>
                {i < HOW_STEPS.length - 1 && (
                  <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-slate-300 sm:block">
                    ›
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div id="workspace" className="mx-auto max-w-6xl px-5 py-8">
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          {/* ===== Left: input ===== */}
          <section className="space-y-4">
            <div className="card">
              <div className="mb-4 flex items-center gap-2">
                <span className="step-no">1</span>
                <h2 className="text-sm font-semibold text-slate-700">
                  계약서 입력
                </h2>
              </div>

              {/* PDF dropzone */}
              <div
                onClick={() => !pdfBusy && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handlePdf(f);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
                  dragOver
                    ? "border-brand-teal bg-teal-50"
                    : "border-slate-300 hover:border-brand-teal hover:bg-slate-50"
                }`}
              >
                <IconUpload />
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  PDF 계약서를 끌어다 놓거나 클릭해 업로드
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  텍스트 레이어 직접 추출 · 스캔본은 자동 OCR(한/영)
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handlePdf(f);
                    e.target.value = "";
                  }}
                />
              </div>

              {pdf?.scanned && ocrFile && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2">
                  <span className="text-xs text-amber-700">
                    텍스트 레이어 없음(스캔본) — 브라우저 OCR 실행
                  </span>
                  <button
                    onClick={handleOcr}
                    disabled={!!pdfBusy}
                    className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    OCR 시도
                  </button>
                </div>
              )}
              {pdfBusy && (
                <p className="mt-2 text-xs font-medium text-brand-teal">
                  {pdfBusy}
                </p>
              )}

              {/* Sample loader */}
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-medium text-slate-400">
                  또는 예시 계약서로 체험 · 클릭하면 바로 분석됩니다
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadSample(s)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      activeSample === s.id
                        ? "border-brand-teal bg-teal-50 text-brand-teal"
                        : "border-slate-200 text-slate-600 hover:border-brand-teal/50 hover:bg-slate-50"
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Loaded input preview / editor */}
            {source ? (
              <div className="card">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`badge ${
                        source.kind === "pdf"
                          ? "bg-sky-100 text-sky-700"
                          : source.kind === "sample"
                            ? "bg-teal-100 text-brand-teal"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {source.kind === "pdf"
                        ? "PDF"
                        : source.kind === "sample"
                          ? "예시"
                          : "직접입력"}
                    </span>
                    <span className="font-medium text-slate-600">
                      {source.label}
                    </span>
                  </div>
                  <button
                    onClick={clearAll}
                    className="text-xs text-slate-400 hover:text-rose-500"
                  >
                    지우기
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => onTextChange(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-3 font-mono text-xs leading-relaxed text-slate-700 focus:border-brand-teal focus:bg-white focus:outline-none"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={useLLM}
                      onChange={(e) => setUseLLM(e.target.checked)}
                      className="accent-brand-teal"
                    />
                    LLM 추출 (서버 키 필요, 없으면 규칙기반)
                  </label>
                  <button
                    onClick={handleExtract}
                    disabled={!hasInput || loading || !!pdfBusy}
                    className="btn-primary"
                  >
                    {loading ? "분석 중…" : "추출 → 분석"}
                    {!loading && <IconArrow />}
                  </button>
                </div>
                {note && <p className="mt-2 text-xs text-slate-400">{note}</p>}
              </div>
            ) : (
              <div className="card border-dashed text-center text-sm text-slate-400">
                계약서를 업로드하거나 예시를 불러오면 여기에 내용이 표시되고
                분석을 시작할 수 있습니다.
                {note && <p className="mt-2 text-xs text-rose-500">{note}</p>}
              </div>
            )}
          </section>

          {/* ===== Right: results ===== */}
          <section className="space-y-5">
            {!analysis ? (
              <EmptyResults hasInput={hasInput} />
            ) : (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-3 gap-3">
                  <KPI
                    label="개시 리스부채"
                    value={won(analysis.schedule.initialLiability)}
                    sub="미래 리스료의 현재가치"
                  />
                  <KPI
                    label="사용권자산"
                    value={won(analysis.schedule.initialRouAsset)}
                    sub="빌려 쓸 권리의 장부가"
                  />
                  <KPI
                    label="위험 플래그"
                    value={`${counts!.high} / ${counts!.medium} / ${counts!.low}`}
                    sub="High / Med / Low"
                    danger={counts!.high > 0}
                  />
                </div>

                {/* Extraction table */}
                <div className="card">
                  <SectionTitle
                    n="2"
                    title="추출 데이터 · 근거 추적성"
                    hint="AI가 계약서에서 뽑아낸 핵심 항목입니다. '신뢰도'는 AI가 그 값을 얼마나 확신하는지, '근거'는 그 값이 계약서 어느 문장에서 나왔는지(마우스를 올리면 전체 보기)를 뜻합니다."
                  />
                  <Legend
                    items={[
                      { dot: "bg-emerald-400", label: "신뢰도 높음 85%+" },
                      { dot: "bg-amber-400", label: "보통 70–84%" },
                      { dot: "bg-rose-400", label: "낮음·검토필요 <70%" },
                    ]}
                  />
                  <div className="overflow-hidden rounded-xl border border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="p-2.5 text-left font-semibold">항목</th>
                          <th className="p-2.5 text-left font-semibold">값</th>
                          <th className="p-2.5 text-left font-semibold">신뢰도</th>
                          <th className="p-2.5 text-left font-semibold">근거</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.keys(FIELD_LABELS) as (keyof ExtractedLease)[]).map(
                          (k) => {
                            const fld = extracted![k];
                            return (
                              <tr
                                key={k}
                                className="border-t border-slate-100 hover:bg-slate-50/60"
                              >
                                <td className="p-2.5 text-slate-500">
                                  {FIELD_LABELS[k]}
                                </td>
                                <td className="p-2.5 font-medium text-slate-800">
                                  {fld.value === null ? (
                                    <span className="text-rose-500">미추출</span>
                                  ) : (
                                    String(fld.value)
                                  )}
                                </td>
                                <td className="p-2.5">
                                  <span className={`badge ${confColor(fld.confidence)}`}>
                                    {(fld.confidence * 100).toFixed(0)}%
                                  </span>
                                </td>
                                <td className="p-2.5 text-slate-400">
                                  <span
                                    className="block max-w-[240px] truncate"
                                    title={fld.evidence}
                                  >
                                    {fld.evidence}
                                  </span>
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
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <SectionTitle n="3" title="독립 재계산 검증" inline />
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-xs">
                      {(["effective", "nominal"] as RateConvention[]).map((c) => (
                        <button
                          key={c}
                          onClick={() => setConvention(c)}
                          className={`rounded-md px-2 py-1 transition ${
                            convention === c
                              ? "bg-brand-teal text-white"
                              : "text-slate-500 hover:bg-slate-50"
                          }`}
                          title="할인율 기간환산 — 유효이자율 (1+r)^(1/m)-1 vs 명목분할 r/m"
                        >
                          {c === "effective" ? "유효이자율" : "명목분할"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mb-2 text-xs leading-relaxed text-slate-400">
                    이 도구가 계약 조건만으로 리스부채를 처음부터 다시 계산해, 회사가
                    제시한 수치와 비교합니다. 차이가 <b>1% 이내면 PASS(적정)</b>,
                    초과하면 <b className="text-rose-500">FAIL(차이 검토 필요)</b>로
                    표시됩니다. 오른쪽 토글로 할인율 환산 가정을 바꿔 차이 원인을
                    분해할 수 있습니다.
                  </p>
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
                              analysis.rc.pass ? "text-emerald-600" : "text-rose-600"
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
                  <SectionTitle
                    n="4"
                    title="위험 플래그 / 발견사항"
                    hint="회계처리에 영향을 줄 수 있는 항목을 자동으로 짚어 줍니다. 각 항목은 위험 등급과 함께, ▸ 표시로 권고 조치를 보여줍니다."
                  />
                  <Legend
                    items={[
                      { dot: "bg-rose-400", label: "HIGH 중대" },
                      { dot: "bg-amber-400", label: "MEDIUM 주의" },
                      { dot: "bg-sky-400", label: "LOW 경미" },
                      { dot: "bg-emerald-400", label: "INFO 이상없음" },
                    ]}
                  />
                  <div className="space-y-2">
                    {analysis.findings.map((f, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-slate-100 bg-slate-50/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`badge ${sevColor(f.severity)}`}>
                            {f.severity.toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-400">
                            {f.category}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-800">{f.message}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          ▸ {f.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Schedule + JE + export */}
                <div className="card">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle n="5" title="상각표 & 개시 분개" inline />
                    <button onClick={downloadWorkpaper} className="btn-ghost">
                      <IconDownload />
                      감사조서 (.md)
                    </button>
                  </div>
                  <p className="mb-3 text-xs leading-relaxed text-slate-400">
                    기간별 리스부채 상각 내역과 개시일 회계 분개입니다. 우측
                    <b> 감사조서(.md)</b> 버튼으로 추출·재계산·발견사항을 담은 조서를
                    내려받을 수 있습니다.
                  </p>
                  <div className="mb-4 max-h-52 overflow-auto rounded-xl border border-slate-100">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="p-2 text-left font-semibold">기</th>
                          <th className="p-2 text-right font-semibold">기초부채</th>
                          <th className="p-2 text-right font-semibold">이자</th>
                          <th className="p-2 text-right font-semibold">지급</th>
                          <th className="p-2 text-right font-semibold">기말부채</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.schedule.liabilitySchedule.map((p) => (
                          <tr key={p.period} className="border-t border-slate-100">
                            <td className="p-2">{p.period}</td>
                            <td className="p-2 text-right">
                              {round(p.opening).toLocaleString()}
                            </td>
                            <td className="p-2 text-right">
                              {round(p.interest).toLocaleString()}
                            </td>
                            <td className="p-2 text-right">
                              {round(p.payment).toLocaleString()}
                            </td>
                            <td className="p-2 text-right">
                              {round(p.closing).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-xs">
                    <p className="mb-1 font-semibold text-slate-500">개시일 분개</p>
                    {analysis.je.debit.map((d, i) => (
                      <p key={i}>
                        (차) {d.account} {d.amount.toLocaleString()}
                      </p>
                    ))}
                    {analysis.je.credit.map((c, i) => (
                      <p key={i} className="pl-6">
                        (대) {c.account} {c.amount.toLocaleString()}
                      </p>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-400">
          LeaseLens · K-IFRS 1116 리스이용자 모형 · 계산엔진은 단위테스트로 검증됨
          (npm test). 본 도구는 감사 보조용이며 전문가의 검토를 대체하지 않습니다.
        </footer>
      </div>
    </main>
  );
}

/* ---------- 작은 컴포넌트 ---------- */

function SectionTitle({
  n,
  title,
  hint,
  inline,
}: {
  n: string;
  title: string;
  hint?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "" : "mb-3"}>
      <div className="flex items-center gap-2">
        <span className="step-no">{n}</span>
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      {hint && !inline && (
        <p className="mt-1.5 pl-8 text-xs leading-relaxed text-slate-400">{hint}</p>
      )}
    </div>
  );
}

/** 색 점 + 라벨 범례 한 줄 */
function Legend({
  items,
}: {
  items: { dot: string; label: string }[];
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
      <span className="font-semibold text-slate-400">읽는 법</span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${it.dot}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="kpi">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${
          danger ? "text-rose-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl bg-slate-50 p-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="mt-0.5 font-medium text-slate-800">{children}</span>
    </div>
  );
}

function EmptyResults({ hasInput }: { hasInput: boolean }) {
  const steps = [
    "예시 클릭(즉시 분석) 또는 PDF 업로드",
    "추출 → 분석 실행 (예시는 자동)",
    "근거·재계산·위험 플래그 확인",
    "감사조서(.md) 내보내기",
  ];
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
        <IconDoc />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-700">
        {hasInput
          ? "‘추출 → 분석’을 눌러 검증을 시작하세요."
          : "분석할 계약서를 먼저 입력하세요."}
      </p>
      <p className="mt-1 max-w-sm text-xs text-slate-400">
        계약서를 업로드(또는 예시 불러오기)해야 추출·재계산이 실행됩니다. 입력
        없이는 분석되지 않습니다.
      </p>
      <ol className="mt-6 w-full max-w-xs space-y-2 text-left">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-7 w-full max-w-sm rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-left">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          결과에 나오는 표시 미리 보기
        </p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>
            <span className="badge bg-emerald-100 text-emerald-700">신뢰도</span>{" "}
            초록=높음 · 주황=보통 · 빨강=검토필요
          </li>
          <li>
            <span className="badge bg-rose-100 text-rose-700">위험등급</span>{" "}
            HIGH 중대 · MEDIUM 주의 · LOW 경미 · INFO 이상없음
          </li>
          <li>
            <span className="badge bg-sky-100 text-sky-700">PASS / FAIL</span>{" "}
            독립 재계산과 회사 수치 차이 1% 이내면 PASS
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ---------- 인라인 아이콘 ---------- */

function LogoMark() {
  return (
    <span className="flex items-center gap-1">
      <span className="h-3 w-3 rounded-sm bg-brand-tealLight" />
      <span className="h-3 w-3 rounded-sm bg-white/70" />
    </span>
  );
}
function IconUpload() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
