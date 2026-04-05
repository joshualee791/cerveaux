import type { RefObject } from "react";
import { MessageRow } from "./message-row";
import type { ChatMessageDTO } from "./types";
import type { MessageRole } from "./types";

function roleForUi(role: string): MessageRole | null {
  if (
    role === "user" ||
    role === "marie" ||
    role === "roy" ||
    role === "assistant"
  )
    return role;
  return null;
}

type Props = {
  userName: string;
  messages: ChatMessageDTO[];
  loading?: boolean;
  scrollEndRef?: RefObject<HTMLDivElement | null>;
};

export function MessageThread({
  userName,
  messages,
  loading,
  scrollEndRef,
}: Props) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : null}
        {!loading && messages.length === 0 ? (
          <p className="text-sm text-neutral-600">Send a message to start.</p>
        ) : null}
        {messages.map((m) => {
          const r = roleForUi(m.role);
          if (!r) return null;
          return (
            <MessageRow
              key={m.id}
              role={r}
              content={m.content}
              userName={userName}
              isStreaming={
                m.id === "__streaming__" || Boolean(m.streaming)
              }
            />
          );
        })}
        {scrollEndRef ? <div ref={scrollEndRef} /> : null}
      </div>
    </div>
  );
}
