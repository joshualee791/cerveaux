import Anthropic from "@anthropic-ai/sdk";
import {
  buildAdaSystemPrompt,
  type AdaMemoryInjection,
} from "@/lib/prompts/ada-system";
import { LABELED_THREAD_GUIDANCE } from "@/lib/prompts/labeled-thread";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type ClaudeTurn = { role: "user" | "assistant"; content: string };

function withLabeledThreadSystem(
  basePrompt: string,
  systemAppend?: string,
): string {
  const core = `${basePrompt}\n\n${LABELED_THREAD_GUIDANCE}`;
  return systemAppend ? `${core}\n\n${systemAppend}` : core;
}

/**
 * Ada-only Claude call (Phase 4).
 *
 * Messages use `toSharedAgentMessages` — labeled [Joshua]/[Ada]/[Leo] transcript.
 * System = §7 identity + §9 Joshua + §10 memory + labeled-thread guidance; optional
 * `systemAppend` adds deferral (§5) for secondary calls only.
 */
export async function callAda(
  messages: ClaudeTurn[],
  options?: { systemAppend?: string; memory?: AdaMemoryInjection },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildAdaSystemPrompt(options?.memory);
  const system = withLabeledThreadSystem(base, options?.systemAppend);

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
 * Stream Ada’s reply token-by-token; full text is the same as a non-streaming call.
 * Primary turn in POST /api/chat; deferral (secondary) still uses {@link callAda}.
 */
export async function streamAda(
  messages: ClaudeTurn[],
  options: {
    systemAppend?: string;
    onDelta: (chunk: string) => void;
    memory?: AdaMemoryInjection;
  },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildAdaSystemPrompt(options.memory);
  const system = withLabeledThreadSystem(base, options.systemAppend);

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
