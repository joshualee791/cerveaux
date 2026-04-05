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
): "ada" | "leo" | null {
  const assistants = rows.filter(
    (r) => r.role === "ada" || r.role === "leo",
  );
  if (assistants.length === 0) return null;
  assistants.sort((a, b) => b.sequence - a.sequence);
  return assistants[0].role as "ada" | "leo";
}

/** Max DB rows to include when building the shared labeled transcript (recent tail). */
export const SHARED_THREAD_MAX_MESSAGES = 80;

export type AgentMessageTurn = {
  role: "user" | "assistant";
  content: string;
};

function trimLeadingNonUser<T extends { role: string }>(rows: T[]): T[] {
  const out = [...rows];
  while (out.length > 0 && out[0].role !== "user") {
    out.shift();
  }
  return out;
}

/**
 * Take the last `maxMessages` rows; drop leading assistant-only rows so the API thread
 * can start with a user message when possible (Claude requires user-first).
 */
export function takeRecentThreadRows<T extends { role: string }>(
  rows: T[],
  maxMessages: number = SHARED_THREAD_MAX_MESSAGES,
): T[] {
  const slice =
    rows.length <= maxMessages ? rows : rows.slice(-maxMessages);
  return trimLeadingNonUser(slice);
}

function labelForRole(role: string, content: string): string {
  if (role === "user") return `[Joshua]: ${content}`;
  if (role === "ada") return `[Ada]: ${content}`;
  if (role === "leo") return `[Leo]: ${content}`;
  return `[${role}]: ${content}`;
}

/**
 * Build Claude/OpenAI message arrays from the full thread with explicit speaker labels.
 * Merges consecutive messages from the same API role into one turn (required alternating user/assistant).
 */
export function toSharedAgentMessages(
  rows: { role: string; content: string }[],
  maxMessages: number = SHARED_THREAD_MAX_MESSAGES,
): AgentMessageTurn[] {
  let slice = takeRecentThreadRows(rows, maxMessages);
  if (slice.length === 0) {
    slice = rows.slice(-Math.min(maxMessages, Math.max(1, rows.length)));
  }

  const parts: AgentMessageTurn[] = [];
  const userLines: string[] = [];
  const assistantLines: string[] = [];

  const flushAssistant = (): void => {
    if (assistantLines.length === 0) return;
    parts.push({
      role: "assistant",
      content: assistantLines.join("\n\n"),
    });
    assistantLines.length = 0;
  };

  const flushUser = (): void => {
    if (userLines.length === 0) return;
    parts.push({
      role: "user",
      content: userLines.join("\n\n"),
    });
    userLines.length = 0;
  };

  for (const row of slice) {
    if (row.role === "user") {
      flushAssistant();
      userLines.push(labelForRole("user", row.content));
    } else if (row.role === "ada" || row.role === "leo") {
      flushUser();
      assistantLines.push(labelForRole(row.role, row.content));
    } else {
      flushAssistant();
      flushUser();
      userLines.push(labelForRole(row.role, row.content));
    }
  }
  flushAssistant();
  flushUser();

  if (parts.length === 0) {
    throw new Error("Internal error: empty shared thread");
  }

  if (parts[0].role === "assistant") {
    return [
      {
        role: "user",
        content:
          "[Joshua]: [Earlier messages omitted — use the assistant messages below as context.]",
      },
      ...parts,
    ];
  }

  return parts;
}
