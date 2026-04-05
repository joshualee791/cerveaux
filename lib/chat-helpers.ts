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

/** Last assistant role in thread before this user turn (for router continuation). */
export function lastAssistantRole(
  rows: { role: string; sequence: number }[],
): "marie" | "roy" | null {
  const assistants = rows.filter(
    (r) => r.role === "marie" || r.role === "roy",
  );
  if (assistants.length === 0) return null;
  assistants.sort((a, b) => b.sequence - a.sequence);
  return assistants[0].role as "marie" | "roy";
}

export function toClaudeMessages(
  rows: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "marie") {
      out.push({ role: "assistant", content: r.content });
    }
  }
  return out;
}

export function toOpenAiTurns(
  rows: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "roy") {
      out.push({ role: "assistant", content: r.content });
    }
  }
  return out;
}

