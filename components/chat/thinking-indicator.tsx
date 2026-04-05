"use client";

export type ThinkingKind =
  | { kind: "pending" }
  | { kind: "named"; agent: "ada" | "leo" };

type Props = {
  state: ThinkingKind;
};

function label(state: ThinkingKind): string {
  if (state.kind === "pending") return "Thinking…";
  return state.agent === "ada" ? "Ada is thinking…" : "Leo is thinking…";
}

export function ThinkingIndicator({ state }: Props) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-dashed border-neutral-300 bg-white/80 px-3 py-2 text-sm text-neutral-600"
      aria-live="polite"
    >
      <span
        className="inline-flex h-2 w-2 animate-pulse rounded-full bg-neutral-400"
        aria-hidden
      />
      <span>{label(state)}</span>
    </div>
  );
}
