import { ChatInput } from "./chat-input";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageThread } from "./message-thread";

type Props = {
  userName: string;
};

export function ChatShell({ userName }: Props) {
  return (
    <div className="flex h-[100dvh] flex-col bg-neutral-50 text-neutral-900 md:flex-row">
      <ConversationSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold">Les Cerveaux</h1>
          <p className="text-sm text-neutral-600">
            Chat shell — responses are placeholders until LLM integration.
          </p>
        </header>
        <MessageThread userName={userName} />
        <ChatInput />
      </div>
    </div>
  );
}
