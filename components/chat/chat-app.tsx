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

type NdjsonEvent =
  | {
      type: "start";
      conversationId: string;
      conversationTitle: string;
      route: string;
      streamingRole: "marie" | "roy";
      messages: ChatMessageDTO[];
    }
  | { type: "delta"; text: string }
  | { type: "primary_saved"; message: ChatMessageDTO }
  | { type: "secondary_saved"; message: ChatMessageDTO }
  | {
      type: "done";
      conversationId: string;
      conversationTitle: string;
      messages: ChatMessageDTO[];
    }
  | { type: "error"; error: string };

const OPTIMISTIC_USER_ID = "__optimistic_user__";

function nextSequence(msgs: ChatMessageDTO[]): number {
  if (msgs.length === 0) return 1;
  return Math.max(...msgs.map((m) => m.sequence)) + 1;
}

/** Remove pending optimistic user + streaming placeholder (e.g. on error). */
function stripOptimistic(msgs: ChatMessageDTO[]): ChatMessageDTO[] {
  return msgs.filter(
    (m) => m.id !== OPTIMISTIC_USER_ID && m.id !== "__streaming__",
  );
}

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
  const [creatingConversation, setCreatingConversation] = useState(false);
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

  async function handleNewConversation() {
    setSendError(null);
    setCreatingConversation(true);
    try {
      const res = await fetch("/api/conversation", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        conversationId?: string;
        title?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
      }
      if (!data.conversationId) {
        throw new Error("Invalid response from server.");
      }
      setConversationId(data.conversationId);
      setConversationTitle(data.title ?? "New Conversation");
      setMessages([]);
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Could not start a new conversation.",
      );
    } finally {
      setCreatingConversation(false);
    }
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSendError(null);
    setSending(true);

    setMessages((prev) => {
      const userSeq = nextSequence(prev);
      const now = new Date().toISOString();
      return [
        ...prev,
        {
          id: OPTIMISTIC_USER_ID,
          role: "user",
          content: trimmed,
          sequence: userSeq,
          createdAt: now,
        },
        {
          id: "__streaming__",
          role: "assistant",
          content: "",
          sequence: userSeq + 1,
          createdAt: now,
          streaming: true,
        },
      ];
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: trimmed,
        }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        setMessages((prev) => stripOptimistic(prev));
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
      }

      if (!ct.includes("ndjson") || !res.body) {
        setMessages((prev) => stripOptimistic(prev));
        throw new Error("Unexpected response from chat.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (ev: NdjsonEvent) => {
        switch (ev.type) {
          case "start": {
            const maxSeq =
              ev.messages.length > 0
                ? Math.max(...ev.messages.map((m) => m.sequence))
                : 0;
            setConversationId(ev.conversationId);
            setConversationTitle(ev.conversationTitle);
            setMessages([
              ...ev.messages,
              {
                id: "__streaming__",
                role: ev.streamingRole,
                content: "",
                sequence: maxSeq + 1,
                createdAt: new Date().toISOString(),
              },
            ]);
            break;
          }
          case "delta":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__"
                  ? { ...m, content: m.content + ev.text }
                  : m,
              ),
            );
            break;
          case "primary_saved":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__" ? ev.message : m,
              ),
            );
            break;
          case "secondary_saved":
            setMessages((prev) => [...prev, ev.message]);
            break;
          case "done":
            setConversationId(ev.conversationId);
            setConversationTitle(ev.conversationTitle);
            setMessages(ev.messages);
            break;
          case "error":
            setSendError(ev.error);
            setMessages((prev) => stripOptimistic(prev));
            break;
          default:
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const nl = buffer.indexOf("\n");
          if (nl < 0) break;
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as NdjsonEvent;
            handleEvent(ev);
          } catch {
            throw new Error("Invalid stream data from server.");
          }
        }
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Request failed.");
      setMessages((prev) => stripOptimistic(prev));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-neutral-50 text-neutral-900 md:flex-row">
      <ConversationSidebar
        conversationTitle={conversationTitle}
        onNewConversation={handleNewConversation}
        newConversationDisabled={
          loadingThread || sending || creatingConversation
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold">Les Cerveaux</h1>
          <p className="text-sm text-neutral-600">
            Marie and Roy — two perspectives, one conversation.
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
