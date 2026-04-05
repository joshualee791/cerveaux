import type { MessageRole } from "./types";

function labelForRole(role: MessageRole, userName: string): string {
  if (role === "user") return userName;
  if (role === "marie") return "Marie";
  return "Roy";
}

type Props = {
  role: MessageRole;
  content: string;
  userName: string;
};

/**
 * Agent name is always explicit (playbook §14) — identity does not rely on color.
 * Optional border accent degrades to grayscale contrast.
 */
export function MessageRow({ role, content, userName }: Props) {
  const label = labelForRole(role, userName);

  const accent =
    role === "marie"
      ? "border-l-slate-500"
      : role === "roy"
        ? "border-amber-600"
        : "border-l-neutral-500";

  return (
    <article
      className={`border-l-4 pl-3 ${accent}`}
      aria-label={`${label} message`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
        {label}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-900">
        {content}
      </p>
    </article>
  );
}
