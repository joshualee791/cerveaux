import Anthropic from "@anthropic-ai/sdk";
import {
  buildMarieSystemPrompt,
  type MarieMemoryInjection,
} from "@/lib/prompts/marie-system";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type ClaudeTurn = { role: "user" | "assistant"; content: string };

/**
 * Marie-only Claude call (Phase 4).
 *
 * Audit (playbook-aligned):
 * - `buildMarieSystemPrompt(memory)` is §7 identity + §9 Joshua + §10 memory; passed
 *   only via Anthropic’s `system` parameter — never
 *   prepended into `messages[].content`.
 * - `messages` must be alternating user/assistant turns derived from DB user/marie
 *   rows only (see `toClaudeMessages`). Optional `systemAppend` adds deferral (§5) for
 *   secondary calls only.
 */
export async function callMarie(
  messages: ClaudeTurn[],
  options?: { systemAppend?: string; memory?: MarieMemoryInjection },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildMarieSystemPrompt(options?.memory);
  const system = options?.systemAppend
    ? `${base}\n\n${options.systemAppend}`
    : base;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages,
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Unexpected Claude response shape");
  }
  return block.text;
}

/**
 * Stream Marie’s reply token-by-token; full text is the same as a non-streaming call.
 * Used for the primary turn in POST /api/chat; deferral (secondary) still uses {@link callMarie}.
 */
export async function streamMarie(
  messages: ClaudeTurn[],
  options: {
    systemAppend?: string;
    onDelta: (chunk: string) => void;
    memory?: MarieMemoryInjection;
  },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildMarieSystemPrompt(options.memory);
  const system = options.systemAppend
    ? `${base}\n\n${options.systemAppend}`
    : base;

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system,
    messages,
  });

  stream.on("text", (textDelta: string) => {
    options.onDelta(textDelta);
  });

  return stream.finalText();
}
