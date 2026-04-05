/**
 * Heuristic: user explicitly addresses one agent and asks to react to / analyze
 * the other agent’s prior output. Used to append one-call-only context in POST /api/chat.
 * Does not change routing or default thread projections.
 */

/** Most recent N messages from the referenced agent (chronological order for display). */
const REFERENCED_CONTEXT_MAX = 3;

export function detectCrossAgentReference(
  raw: string,
  respondingAgent: "marie" | "roy",
): "marie" | "roy" | null {
  const other: "marie" | "roy" =
    respondingAgent === "marie" ? "roy" : "marie";
  if (!referencesOtherAgentByName(raw, other)) return null;
  if (!hasReactionOrAnalysisIntent(raw, other)) return null;
  return other;
}

/** ASCII ' or typographic ’ (U+2019) for possessives */
const APOST = "['\u2019]";

function referencesOtherAgentByName(text: string, other: "marie" | "roy"): boolean {
  if (other === "marie") {
    return (
      /\bmarie\b|@marie\b/i.test(text) ||
      new RegExp(`\\bmarie\\s*${APOST}s\\b`, "i").test(text)
    );
  }
  return (
    /\broy\b|@roy\b/i.test(text) ||
    new RegExp(`\\broy\\s*${APOST}s\\b`, "i").test(text)
  );
}

/**
 * Reaction / commentary intent — keep deterministic; avoid matching generic mentions.
 */
function hasReactionOrAnalysisIntent(text: string, other: "marie" | "roy"): boolean {
  const possessiveMarie = new RegExp(`\\bmarie\\s*${APOST}s\\b`, "i");
  const possessiveRoy = new RegExp(`\\broy\\s*${APOST}s\\b`, "i");
  if (other === "marie" && possessiveMarie.test(text)) return true;
  if (other === "roy" && possessiveRoy.test(text)) return true;

  const named = other === "roy" ? "roy" : "marie";
  if (
    new RegExp(
      `\\bwhat\\s+${named}\\s+(?:said|wrote|answered|responded|replied)\\b`,
      "i",
    ).test(text)
  ) {
    return true;
  }

  return /\b(what do you think(?:\s+of)?|what'?s\s+your\s+take\s+on|how\s+do\s+you\s+like|your\s+opinion\s+of|opinion\s+on|think about|thoughts?\s+on|tell me about|comment on|critique|critiquing|critiques|analyze|analysing|analyzing|review|reviewing|respond(?:\s+to)?|reply(?:\s+to)?|read|look at|evaluate|evaluating|react(?:\s+to)?|your take|your view|how do you feel about|referring to|in response to)\b/i.test(
    text,
  );
}

/**
 * Up to {@link REFERENCED_CONTEXT_MAX} most recent messages from `role`, oldest-first for injection.
 */
export function recentReferencedAgentContextWindow<
  T extends { role: string; content: string; sequence: number },
>(rows: T[], role: "marie" | "roy"): T[] {
  const fromAgent = rows
    .filter((r) => r.role === role)
    .sort((a, b) => b.sequence - a.sequence);
  const window = fromAgent.slice(0, REFERENCED_CONTEXT_MAX);
  window.sort((a, b) => a.sequence - b.sequence);
  return window;
}

/**
 * One-call-only system append: small recent window from the referenced agent only.
 */
export function buildCrossAgentReferenceContextAppend(
  referencedRole: "marie" | "roy",
  messages: { sequence: number; content: string }[],
): string {
  const label = referencedRole === "marie" ? "Marie" : "Roy";
  if (messages.length === 0) {
    return `--- REFERENCED AGENT CONTEXT ---
No prior messages from ${label} are available in this conversation. Do not invent any. Tell the user honestly that there is nothing from ${label} to use as reference.`;
  }

  const blocks = messages.map((m) => {
    const body = m.content.trim();
    return `[seq ${m.sequence}]\n${body}`;
  });

  return `--- REFERENCED AGENT CONTEXT ---
Recent messages from ${label} in this conversation:

${blocks.join("\n\n")}

Respond to the user's request using these messages as reference context.
Do not invent prior messages beyond what is shown here.`;
}

/** @deprecated Use {@link recentReferencedAgentContextWindow} — kept for callers needing latest row only. */
export function lastMessageFromAgentInThread<
  T extends { role: string; content: string; sequence: number },
>(rows: T[], role: "marie" | "roy"): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.role !== role) continue;
    if (!best || r.sequence > best.sequence) best = r;
  }
  return best;
}
