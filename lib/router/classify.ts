import Anthropic from "@anthropic-ai/sdk";

/** Haiku — playbook §4 classification. */
const ROUTER_MODEL =
  process.env.ANTHROPIC_ROUTER_MODEL ?? "claude-3-5-haiku-20241022";

export type RouteLabel =
  | "MARIE_ONLY"
  | "ROY_ONLY"
  | "MARIE_PRIMARY"
  | "ROY_PRIMARY";

/**
 * Classify the user message. Output must be exactly one RouteLabel (playbook §4).
 * priorAgent: last assistant in thread before this user message, or "none".
 */
export async function classifyRoute(
  userMessage: string,
  priorAgent: "Marie" | "Roy" | "none",
): Promise<RouteLabel> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const priorLine = priorAgent === "none" ? "(none)" : priorAgent;

  const userPrompt = `Given this user message, respond with exactly one of:
MARIE_ONLY, ROY_ONLY, MARIE_PRIMARY, ROY_PRIMARY

MARIE_ONLY: explicitly addressed to Marie, or unambiguously technical/architectural
ROY_ONLY: explicitly addressed to Roy, or unambiguously conceptual/philosophical/emotional
MARIE_PRIMARY: technical lean but warrants both perspectives, Marie responds first
ROY_PRIMARY: default — ambiguous, general, or mixed signal, Roy responds first

Message: ${userMessage}
Prior turn agent (if continuation): ${priorLine}`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 80,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    return "ROY_PRIMARY";
  }

  const raw = block.text.trim().toUpperCase();
  const m = raw.match(
    /\b(MARIE_ONLY|ROY_ONLY|MARIE_PRIMARY|ROY_PRIMARY)\b/,
  );
  if (!m) {
    return "ROY_PRIMARY";
  }
  return m[1] as RouteLabel;
}
