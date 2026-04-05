import { MessageRow } from "./message-row";
import type { MessageRole } from "./types";

const STATIC_MESSAGES: { role: MessageRole; content: string }[] = [
  {
    role: "user",
    content:
      "Placeholder user message — chat logic arrives in a later phase.",
  },
  {
    role: "marie",
    content:
      "Placeholder Marie line. The label above is the primary identity signal (structure only).",
  },
  {
    role: "roy",
    content:
      "Placeholder Roy line. Layout stays legible without relying on color.",
  },
];

type Props = {
  userName: string;
};

export function MessageThread({ userName }: Props) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {STATIC_MESSAGES.map((m, i) => (
          <MessageRow
            key={i}
            role={m.role}
            content={m.content}
            userName={userName}
          />
        ))}
      </div>
    </div>
  );
}
