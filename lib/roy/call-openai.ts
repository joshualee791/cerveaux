import OpenAI from "openai";
import { buildRoySystemPrompt } from "@/lib/prompts/roy-system";

/** Default when `OPENAI_MODEL` is unset — GPT-4.1 per OpenAI: strong instruction following vs GPT-4o. */
const DEFAULT_MODEL = "gpt-4.1";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Roy-only OpenAI call (Phase 5).
 *
 * Thread model (storage vs read):
 * - The database keeps one chronological thread per `conversation` (all `messages` rows).
 * - Each agent only receives a filtered projection of that thread (here: `user` + `roy` turns).
 * - Marie’s assistant rows are not duplicated elsewhere and are omitted from Roy’s API payload.
 *
 * Prompt / flow: system = §8 + §9 + empty memory stubs; optional `systemAppend` adds deferral
 * for secondary calls. `turns` are user/assistant from projected rows only.
 */
export async function callRoy(
  turns: Turn[],
  options?: { systemAppend?: string },
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const base = buildRoySystemPrompt();
  const system = options?.systemAppend
    ? `${base}\n\n${options.systemAppend}`
    : base;

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, ...turns],
    // Hardcoded tuning (Phase 5 refinement): calmer sampling than API default; not env-configured.
    temperature: 0.65,
    top_p: 1,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Empty OpenAI response");
  }
  return text;
}
