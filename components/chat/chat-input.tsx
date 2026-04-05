"use client";

import { FormEvent, useRef, useState } from "react";

type Props = {
  onSend: (text: string, file: File | null) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const t = value.trim();
    if (!t || disabled) return;
    setValue("");
    const f = file;
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await onSend(t, f);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submit();
  }

  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-4 py-3">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="chat-message">
            Message
          </label>
          <textarea
            id="chat-message"
            name="message"
            rows={2}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder ?? "Message…"}
            disabled={disabled}
            className="min-h-[2.5rem] flex-1 resize-y rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:opacity-60"
          />
          <div className="flex shrink-0 flex-col gap-1 self-end">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="*/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(f ?? null);
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-neutral-300 bg-white px-2 py-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              Attach
            </button>
            <button
              type="submit"
              disabled={disabled || !value.trim()}
              className="rounded border border-neutral-400 bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
        {file ? (
          <div className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700">
            <span className="truncate" title={file.name}>
              {file.name}
            </span>
            <button
              type="button"
              className="shrink-0 text-neutral-500 hover:text-neutral-800"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
