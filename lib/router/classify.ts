import Anthropic from "@anthropic-ai/sdk";

/** Haiku — playbook §4 classification. */
const ROUTER_MODEL =
  process.env.ANTHROPIC_ROUTER_MODEL ?? "claude-haiku-4-5";

export type RouteLabel =
  | "ADA_ONLY"
  | "LEO_ONLY"
  | "ADA_PRIMARY"
  | "LEO_PRIMARY"
  /** Heuristic group check-in; both agents respond without deferral framing (set in route, not Haiku). */
  | "COMMUNAL_DUAL";

const CLASSIFIER_PROMPT = `You route each user message to exactly one label:

ADA_ONLY, LEO_ONLY, ADA_PRIMARY, LEO_PRIMARY

Default outcomes are ADA_ONLY and LEO_ONLY. Prefer ADA_ONLY or LEO_ONLY when a single agent can reasonably answer the question.

Use ADA_PRIMARY or LEO_PRIMARY sparingly — only when:
- the question clearly benefits from two distinct perspectives (technical + human/meaning), OR
- it is explicitly ambiguous or mixed (e.g. both engineering and emotional content without a clear lean).

Do not use PRIMARY states for simple, single-topic, or routine messages.

ADA_ONLY: technical, architectural, implementation, systems, tooling — or user addresses Ada. Default for strong technical topics.
LEO_ONLY: conceptual, philosophical, emotional, meaning-making — or user addresses Leo. Default for strong emotional/conceptual topics.
ADA_PRIMARY: rare — needs both agents; Ada should speak first (technical-led mixed question).
LEO_PRIMARY: rare — needs both agents; Leo should speak first (human-led mixed question).

Message:
`;

/** Strong technical lean → single agent Ada (do not route to BOTH unless mixed). */
function hasStrongTechnicalSignal(message: string): boolean {
  return /\b(design|architecture|api|database|scaling)\b/i.test(message);
}

/** Strong emotional/conceptual lean → single agent Leo (do not route to BOTH unless mixed). */
function hasStrongEmotionalSignal(message: string): boolean {
  return (
    /\bi\s+feel\b/i.test(message) ||
    /\bi'?m\s+stuck\b/i.test(message) ||
    /something\s+feels\s+off/i.test(message)
  );
}

/**
 * When the model returns PRIMARY but the message clearly fits one domain,
 * prefer a single agent. When both domains fire, treat as genuinely mixed — keep the model label.
 * Does not rewrite LEO_ONLY → ADA_ONLY on technical heuristics (explicit / classifier Leo must stay Leo).
 */
function applyDomainSignals(
  message: string,
  label: RouteLabel,
): RouteLabel {
  const technical = hasStrongTechnicalSignal(message);
  const emotional = hasStrongEmotionalSignal(message);

  if (technical && emotional) {
    return label;
  }
  if (technical) {
    if (label === "ADA_PRIMARY" || label === "LEO_PRIMARY") {
      return "ADA_ONLY";
    }
    return label;
  }
  if (emotional) {
    if (
      label === "ADA_PRIMARY" ||
      label === "LEO_PRIMARY" ||
      label === "ADA_ONLY"
    ) {
      return "LEO_ONLY";
    }
    return label;
  }
  return label;
}

/**
 * Classify the user message. Output must be exactly one RouteLabel (playbook §4).
 * priorAgent: last assistant in thread before this user message, or "none".
 */
export async function classifyRoute(
  userMessage: string,
  priorAgent: "Ada" | "Leo" | "none",
): Promise<RouteLabel> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const priorLine = priorAgent === "none" ? "(none)" : priorAgent;

  const userPrompt = `${CLASSIFIER_PROMPT}${userMessage}

Prior turn agent (if continuation): ${priorLine}

Reply with exactly one token: ADA_ONLY, LEO_ONLY, ADA_PRIMARY, or LEO_PRIMARY.`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 80,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  let raw = "";
  if (!block || block.type !== "text") {
    const final: RouteLabel = "LEO_ONLY";
    console.log("[router/classify]", {
      rawClassifierResponse: raw,
      parsedLabel: null,
      finalLabel: final,
    });
    return final;
  }

  raw = block.text;
  const upper = raw.trim().toUpperCase();
  const m = upper.match(
    /\b(ADA_ONLY|LEO_ONLY|ADA_PRIMARY|LEO_PRIMARY)\b/,
  );
  let parsed: RouteLabel | null = m ? (m[1] as RouteLabel) : null;
  if (!parsed) {
    const final: RouteLabel = "LEO_ONLY";
    console.log("[router/classify]", {
      rawClassifierResponse: raw,
      parsedLabel: null,
      finalLabel: final,
    });
    return final;
  }

  const afterSignals = applyDomainSignals(userMessage, parsed);
  console.log("[router/classify]", {
    rawClassifierResponse: raw,
    parsedLabel: parsed,
    finalLabel: afterSignals,
  });
  return afterSignals;
}
