/**
 * Lightweight detection for group/social check-ins where both agents should answer briefly.
 * Does not replace the Haiku router for substantive turns — see `detectCommunalPrompt` contract in route.
 */

/** Appended to Ada’s system prompt on the first turn in communal dual-response. */
export const COMMUNAL_PRIMARY_APPEND = `GROUP CHECK-IN
The user is addressing the room (greeting, social check-in, or light question to everyone). Keep your reply brief and in character. Speak only as yourself — do not narrate for Leo or stage-manage his turn.`;

/**
 * Secondary agent in communal mode: no deferral / additive framing; independent brief reply.
 */
export function buildCommunalSecondaryPrompt(peerAgent: "Ada" | "Leo"): string {
  return `GROUP CHECK-IN
${peerAgent} already replied in the thread above. The user wants both voices present — respond briefly in your own voice only. Do not summarize, grade, or evaluate ${peerAgent}'s message unless the user explicitly asked for that. No meta-commentary on the dual-agent setup.`;
}

/**
 * Returns true when the message looks like a communal / group-addressed social prompt.
 * Call only when there is no explicit single-agent target (no @ada/@leo, etc.).
 */
export function detectCommunalPrompt(raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0 || t.length > 320) return false;

  // Exclude clearly substantive / technical one-shot questions (keep normal routing).
  if (
    /\b(normaliz|architecture|jungian|theorem|refactor|deploy|implement|database|API\s+design|explain\s+how)\b/i.test(
      t,
    )
  ) {
    return false;
  }

  const group =
    /\b(guys|folks|everyone|y'all|you\s+both|both\s+of\s+you|you\s+two)\b/i.test(
      t,
    );
  const greetingOpen =
    /^(hi|hey|hello|good\s+(morning|afternoon|evening)|morning|afternoon)\b/i.test(
      t,
    );
  const howGroup =
    /\bhow\s+are\s+you\b/i.test(t) &&
    /\b(guys|both|everyone|y'all|you\s+two)\b/i.test(t);
  const whatBoth =
    /\bwhat\s+are\s+you\s+both\b/i.test(t) ||
    /\b(you\s+both|both\s+of\s+you).*\?/i.test(t);
  const coffeeOrLight =
    /\b(coffee\s+order|listening\s+to\s+lately)\b/i.test(t) ||
    (/\bfavorite\b/i.test(t) && /\b(movie|week|lately)\b/i.test(t));

  if (greetingOpen && group) return true;
  if (howGroup) return true;
  if (whatBoth) return true;
  if (coffeeOrLight && /\b(morning|today|lately|week)\b/i.test(t)) return true;

  // Short "Hi guys" / "Hey folks" style without requiring a long greeting prefix match.
  if (/^(hi|hey|hello)\b/i.test(t) && group) return true;

  return false;
}
