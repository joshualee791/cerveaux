"use client";

import { FormEvent, useState } from "react";

type Props = {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = value.trim();
    if (!t || disabled) return;
    setValue("");
    await onSend(t);
  }

  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-4 py-3">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl gap-2">
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          name="message"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? "Message…"}
          disabled={disabled}
          className="min-h-[2.5rem] flex-1 resize-y rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="self-end rounded border border-neutral-400 bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
