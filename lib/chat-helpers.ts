/** Loose UUID shape check for route params and client-supplied ids */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function titleFromFirstMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "Conversation";
  return t.length <= 80 ? t : `${t.slice(0, 77)}...`;
}
