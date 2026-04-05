"use client";

import { SignOutButton } from "./sign-out-button";
import type { ConversationListItem } from "./types";

type Props = {
  conversations: ConversationListItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void | Promise<void>;
  onDeleteConversation: (id: string) => void | Promise<void>;
  collapsed: boolean;
  newConversationDisabled?: boolean;
  selectDisabled?: boolean;
  loadingList?: boolean;
};

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  collapsed,
  newConversationDisabled,
  selectDisabled,
  loadingList,
}: Props) {
  return (
    <aside
      className={`flex w-full shrink-0 flex-col overflow-hidden border-b border-neutral-200 bg-neutral-100 transition-[width] duration-200 ease-out md:h-auto md:border-b-0 md:border-r ${
        collapsed ? "md:w-0 md:min-w-0 md:border-transparent" : "md:w-56"
      }`}
      aria-hidden={collapsed ? true : undefined}
    >
      <div className="flex h-full w-full flex-1 flex-col md:w-56">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Conversations
          </h2>
        </div>
        <div className="border-b border-neutral-200 p-2">
          <button
            type="button"
            onClick={() => void onNewConversation()}
            disabled={newConversationDisabled}
            className="w-full rounded border border-neutral-400 bg-white px-2 py-2 text-left text-sm font-medium text-neutral-900 shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New Conversation
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Conversations">
          {loadingList ? (
            <p className="px-2 text-sm text-neutral-500">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="px-2 text-sm text-neutral-500">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => {
                const isActive = activeConversationId === c.id;
                return (
                  <li key={c.id} className="group flex gap-1">
                    <button
                      type="button"
                      disabled={selectDisabled}
                      onClick={() => onSelectConversation(c.id)}
                      className={`min-w-0 flex-1 rounded border px-2 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        isActive
                          ? "border-neutral-900 bg-white font-medium text-neutral-900 shadow-sm"
                          : "border-neutral-300 bg-neutral-50 text-neutral-800 hover:bg-white"
                      }`}
                    >
                      <span className="line-clamp-2">{c.title}</span>
                      <span className="mt-0.5 block text-xs font-normal text-neutral-500">
                        {c.preview ?? formatShortTime(c.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Delete conversation"
                      disabled={selectDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteConversation(c.id);
                      }}
                      className="shrink-0 rounded border border-transparent px-1.5 py-2 text-xs text-neutral-500 opacity-70 hover:border-red-200 hover:bg-red-50 hover:text-red-800 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <div className="border-t border-neutral-200 p-2">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

export function SidebarCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="hidden rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 md:inline-flex"
      aria-expanded={!collapsed}
    >
      {collapsed ? "Show sidebar" : "Hide sidebar"}
    </button>
  );
}
