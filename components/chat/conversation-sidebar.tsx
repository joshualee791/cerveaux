import { SignOutButton } from "./sign-out-button";

type Props = {
  conversationTitle: string | null;
};

export function ConversationSidebar({ conversationTitle }: Props) {
  const label = conversationTitle?.trim() || "No conversation yet";

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-neutral-100 md:h-auto md:w-56 md:border-b-0 md:border-r">
      <div className="border-b border-neutral-200 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Conversations
        </h2>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Conversations">
        <ul className="space-y-1">
          <li>
            <div
              className="w-full rounded border border-neutral-300 bg-white px-2 py-2 text-left text-sm text-neutral-800"
              title="Thread switching comes in a later phase"
            >
              {label}
            </div>
          </li>
        </ul>
      </nav>
      <div className="border-t border-neutral-200 p-2">
        <SignOutButton />
      </div>
    </aside>
  );
}
