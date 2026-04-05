/**
 * §5 Deferral — secondary agent sees primary’s reply in-system; not duplicated in message rows.
 */
export function buildDeferralPrompt(
  primaryAgent: "Marie" | "Roy",
  primaryResponse: string,
): string {
  return `--- PRIMARY RESPONSE ---
${primaryAgent} just responded:
${primaryResponse}

You may:
- Add your perspective if it differs meaningfully
- Defer explicitly if you have nothing to add
- Disagree and say why

Do not duplicate what was already said.`;
}
