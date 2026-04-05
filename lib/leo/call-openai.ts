import OpenAI from "openai";
import {
  buildLeoSystemPrompt,
  type LeoMemoryInjection,
} from "@/lib/prompts/leo-system";
import { LABELED_THREAD_GUIDANCE } from "@/lib/prompts/labeled-thread";

/** Default when `OPENAI_MODEL` is unset — GPT-4.1 per OpenAI: strong instruction following vs GPT-4o. */
const DEFAULT_MODEL = "gpt-4.1";

type Turn = { role: "user" | "assistant"; content: string };

function withLabeledThreadSystem(
  basePrompt: string,
  systemAppend?: string,
): string {
  const core = `${basePrompt}\n\n${LABELED_THREAD_GUIDANCE}`;
  return systemAppend ? `${core}\n\n${systemAppend}` : core;
}

/**
 * Leo-only OpenAI call (Phase 5).
 *
 * Messages use `toSharedAgentMessages` — labeled [Joshua]/[Ada]/[Leo] transcript.
 */
export async function callLeo(
  turns: Turn[],
  options?: { systemAppend?: string; memory?: LeoMemoryInjection },
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const base = buildLeoSystemPrompt(options?.memory);
  const system = withLabeledThreadSystem(base, options?.systemAppend);

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, ...turns],
    temperature: 0.65,
    top_p: 1,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Empty OpenAI response");
  }
  return text;
}

/**
 * Stream Leo’s reply chunk-by-chunk; full text matches a non-streaming call.
 * Primary turn in POST /api/chat; deferral still uses {@link callLeo}.
 */
export async function streamLeo(
  turns: Turn[],
  options: {
    systemAppend?: string;
    onDelta: (chunk: string) => void;
    memory?: LeoMemoryInjection;
  },
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const base = buildLeoSystemPrompt(options.memory);
  const system = withLabeledThreadSystem(base, options.systemAppend);

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, ...turns],
    temperature: 0.65,
    top_p: 1,
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      options.onDelta(delta);
    }
  }

  if (!full) {
    throw new Error("Empty OpenAI response");
  }
  return full;
}
