"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "./chat-input";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageThread } from "./message-thread";
import type { ChatMessageDTO } from "./types";

type Props = {
  userName: string;
};

type LatestResponse = {
  conversation: {
    conversationId: string;
    title: string;
    messages: ChatMessageDTO[];
  } | null;
};

export function ChatApp({ userName }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingThread(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/conversation/latest");
        if (!res.ok) {
          throw new Error(`Failed to load conversation (${res.status})`);
        }
        const data = (await res.json()) as LatestResponse;
        if (cancelled) return;

        if (data.conversation) {
          setConversationId(data.conversation.conversationId);
          setConversationTitle(data.conversation.title);
          setMessages(data.conversation.messages);
        } else {
          setConversationId(null);
          setConversationTitle(null);
          setMessages([]);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Could not load conversation.",
          );
        }
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSendError(null);
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: trimmed,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
      }

      const nextId = data.conversationId as string;
      const nextMessages = data.messages as ChatMessageDTO[];
      const title = data.conversationTitle as string;

      setConversationId(nextId);
      setConversationTitle(title);
      setMessages(nextMessages);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-neutral-50 text-neutral-900 md:flex-row">
      <ConversationSidebar conversationTitle={conversationTitle} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold">Les Cerveaux</h1>
          <p className="text-sm text-neutral-600">
            Marie and Roy — routing is automatic (Haiku classifier).
          </p>
        </header>
        {loadError ? (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {loadError}
          </p>
        ) : null}
        {sendError ? (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
            {sendError}
          </p>
        ) : null}
        <MessageThread
          userName={userName}
          messages={messages}
          loading={loadingThread}
          scrollEndRef={scrollEndRef}
        />
        <ChatInput
          onSend={handleSend}
          disabled={sending || loadingThread}
          placeholder="Message…"
        />
      </div>
    </div>
  );
}
