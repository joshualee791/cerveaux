"use client";

import { useCallback, useState } from "react";
import { MessageContent } from "./message-content";
import { stripLeadingSpeakerLabel } from "./strip-leading-speaker-label";
import type { MessageRole } from "./types";

function labelForRole(role: MessageRole, userName: string): string {
  if (role === "user") return userName;
  if (role === "ada") return "Ada";
  if (role === "leo") return "Leo";
  return "Assistant";
}

function ClipboardIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function MessageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      className="mt-1 inline-flex rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}

type Props = {
  role: MessageRole;
  content: string;
  userName: string;
  /** Primary-agent stream in progress — body empty before first tokens. */
  isStreaming?: boolean;
};

/**
 * Agent name is always explicit (playbook §14) — identity does not rely on color.
 * Optional border accent degrades to grayscale contrast.
 */
export function MessageRow({
  role,
  content,
  userName,
  isStreaming,
}: Props) {
  const label = labelForRole(role, userName);

  const accent =
    role === "ada"
      ? "border-l-slate-500"
      : role === "leo"
        ? "border-amber-600"
        : role === "assistant"
          ? "border-l-neutral-400"
          : "border-l-neutral-500";

  const isAssistant = role !== "user";
  const displayContent =
    isAssistant && content.length > 0
      ? stripLeadingSpeakerLabel(content)
      : content;

  const showBody = !(isStreaming && !content);
  const copySource = isAssistant ? displayContent : content;

  return (
    <article
      className={`border-l-4 pl-3 ${accent}`}
      aria-label={`${label} message`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
        {label}
      </div>
      {showBody ? (
        <div className="mt-1 text-sm leading-relaxed">
          <MessageContent content={displayContent} />
          <MessageCopyButton text={copySource} />
        </div>
      ) : null}
    </article>
  );
}
