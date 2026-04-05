"use client";

type Props = {
  retrying?: boolean;
  onRetry: () => void;
};

export function AdaFallbackRow({ retrying, onRetry }: Props) {
  return (
    <article className="border-l-4 border-l-slate-500 pl-3" aria-label="Ada retry fallback">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
        Ada
      </div>
      <div className="mt-1 text-sm text-neutral-700">
        Ada had trouble completing that response.
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={Boolean(retrying)}
        className="mt-2 inline-flex rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </article>
  );
}
