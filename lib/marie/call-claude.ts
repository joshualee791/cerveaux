import Anthropic from "@anthropic-ai/sdk";
import { buildMarieSystemPrompt } from "@/lib/prompts/marie-system";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type ClaudeTurn = { role: "user" | "assistant"; content: string };

/**
 * Marie-only Claude call (Phase 4).
 *
 * Audit (playbook-aligned):
 * - `buildMarieSystemPrompt()` is the full §7 identity + §9 Joshua context + empty
 *   memory stubs; it is passed only via Anthropic’s `system` parameter — never
 *   prepended into `messages[].content`.
 * - `messages` must be alternating user/assistant turns derived from DB user/marie
 *   rows only (see `toClaudeMessages`). Optional `systemAppend` adds deferral (§5) for
 *   secondary calls only.
 */
export async function callMarie(
  messages: ClaudeTurn[],
  options?: { systemAppend?: string },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildMarieSystemPrompt();
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
