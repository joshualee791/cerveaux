import { SignOutButton } from "./sign-out-button";

const PLACEHOLDER_THREADS = [
  { id: "a", title: "Current (placeholder)" },
  { id: "b", title: "Another thread (placeholder)" },
];

/**
 * Sidebar shell only — no list fetch, routing, or create/delete (phase 14).
 */
export function ConversationSidebar() {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-neutral-100 md:h-auto md:w-56 md:border-b-0 md:border-r">
      <div className="border-b border-neutral-200 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Conversations
        </h2>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Conversations">
        <ul className="space-y-1">
          {PLACEHOLDER_THREADS.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                disabled
                className={`w-full rounded px-2 py-2 text-left text-sm text-neutral-800 ${
                  i === 0
                    ? "border border-neutral-300 bg-white"
                    : "text-neutral-500"
                }`}
                title="Thread switching is not wired yet"
              >
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-neutral-200 p-2">
        <SignOutButton />
      </div>
    </aside>
  );
}
