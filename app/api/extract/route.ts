// 계약서 → 구조화 추출 LLM 엔드포인트.
// 두 가지 프로바이더를 지원한다 (Gen AI API + 오픈소스 LLM).
//   - provider="anthropic" : Gen AI API (ANTHROPIC_API_KEY). Vercel 배포 기본.
//   - provider="ollama"    : 오픈소스 LLM 로컬 추론(Ollama). 자가호스팅/로컬 데모.
// 어느 쪽도 불가하면 클라이언트가 규칙기반(extractRuleBased)으로 폴백한다.
import { NextRequest, NextResponse } from "next/server";
import { EXTRACTION_PROMPT } from "@/lib/extraction/extractor";

export const runtime = "nodejs";

type Provider = "anthropic" | "ollama";

async function callAnthropic(text: string, key: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 1500,
      system: EXTRACTION_PROMPT,
      messages: [{ role: "user", content: text.slice(0, 12000) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text ?? "{}";
}

async function callOllama(text: string, host: string): Promise<string> {
  // 오픈소스 LLM(Ollama) 로컬/자가호스팅 추론
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? "llama3.1",
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: text.slice(0, 12000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  return data?.message?.content ?? "{}";
}

export async function POST(req: NextRequest) {
  const { text, provider } = (await req.json()) as {
    text?: string;
    provider?: Provider;
  };
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  const ollamaHost = process.env.OLLAMA_HOST; // 예: http://localhost:11434
  const chosen: Provider | null =
    provider === "ollama" && ollamaHost
      ? "ollama"
      : key
        ? "anthropic"
        : ollamaHost
          ? "ollama"
          : null;

  if (!chosen) {
    return NextResponse.json(
      {
        error: "no_provider",
        message:
          "ANTHROPIC_API_KEY 또는 OLLAMA_HOST 미설정 — 클라이언트 규칙기반으로 폴백",
      },
      { status: 501 }
    );
  }

  try {
    const raw =
      chosen === "anthropic"
        ? await callAnthropic(text, key!)
        : await callOllama(text, ollamaHost!);
    const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return NextResponse.json({ provider: chosen, extracted: JSON.parse(jsonStr) });
  } catch (e) {
    return NextResponse.json(
      { error: "upstream_or_parse", detail: String(e) },
      { status: 502 }
    );
  }
}
