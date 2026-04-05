"use client";

import { FormEvent, useState } from "react";

/**
 * Shell only — submit does not call APIs (later phases).
 */
export function ChatInput() {
  const [value, setValue] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Intentionally no-op until chat API exists.
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
          placeholder="Message (not sent yet)"
          className="min-h-[2.5rem] flex-1 resize-y rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
        />
        <button
          type="submit"
          className="self-end rounded border border-neutral-400 bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200"
        >
          Send
        </button>
      </form>
    </div>
  );
}
