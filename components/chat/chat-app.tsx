"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "./chat-input";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageThread } from "./message-thread";
import type { ChatMessageDTO, ConversationListItem } from "./types";

type Props = {
  userName: string;
};

type ConversationsResponse = {
  conversations: ConversationListItem[];
};

type MessagesResponse = {
  conversationId: string;
  title: string;
  messages: ChatMessageDTO[];
};

type NdjsonEvent =
  | {
      type: "start";
      conversationId: string;
      conversationTitle: string;
      route: string;
      streamingRole: "ada" | "leo";
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

/** Remove pending optimistic user + streaming placeholder (e.g. on error or switch). */
function stripOptimistic(msgs: ChatMessageDTO[]): ChatMessageDTO[] {
  return msgs.filter(
    (m) => m.id !== OPTIMISTIC_USER_ID && m.id !== "__streaming__",
  );
}

export function ChatApp({ userName }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const beforeSwitchRef = useRef<{
    conversationId: string | null;
    messages: ChatMessageDTO[];
  } | null>(null);

  const scrollToBottom = useCallback(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (!res.ok) return;
    const data = (await res.json()) as ConversationsResponse;
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingThread(true);
      setLoadingList(true);
      setLoadError(null);
      try {
        const listRes = await fetch("/api/conversations");
        if (!listRes.ok) {
          throw new Error(`Failed to load conversations (${listRes.status})`);
        }
        const listData = (await listRes.json()) as ConversationsResponse;
        if (cancelled) return;
        setConversations(listData.conversations);
        setLoadingList(false);

        if (listData.conversations.length === 0) {
          setConversationId(null);
          setMessages([]);
          setLoadingThread(false);
          return;
        }

        const first = listData.conversations[0];
        const msgRes = await fetch(
          `/api/conversation/${encodeURIComponent(first.id)}/messages`,
        );
        if (!msgRes.ok) {
          throw new Error(`Failed to load messages (${msgRes.status})`);
        }
        const msgData = (await msgRes.json()) as MessagesResponse;
        if (cancelled) return;
        setConversationId(msgData.conversationId);
        setMessages(msgData.messages);
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

  async function selectConversation(id: string) {
    if (
      sending ||
      creatingConversation ||
      loadingConversation ||
      loadingList
    ) {
      return;
    }
    if (id === conversationId) return;

    beforeSwitchRef.current = {
      conversationId,
      messages: stripOptimistic(messages),
    };
    setLoadingConversation(true);
    setSendError(null);
    setMessages([]);
    setConversationId(id);

    try {
      const res = await fetch(
        `/api/conversation/${encodeURIComponent(id)}/messages`,
      );
      const data = (await res.json().catch(() => ({}))) as
        | MessagesResponse
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : `Error (${res.status})`,
        );
      }
      const ok = data as MessagesResponse;
      setMessages(ok.messages);
      beforeSwitchRef.current = null;
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Could not load conversation.",
      );
      const prev = beforeSwitchRef.current;
      if (prev) {
        setConversationId(prev.conversationId);
        setMessages(prev.messages);
      }
      beforeSwitchRef.current = null;
    } finally {
      setLoadingConversation(false);
    }
  }

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
      setMessages([]);
      await refreshConversations();
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
            setMessages(ev.messages);
            void refreshConversations();
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

  const navLocked =
    sending || creatingConversation || loadingConversation || loadingList;

  return (
    <div className="flex h-[100dvh] flex-col bg-neutral-50 text-neutral-900 md:flex-row">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelectConversation={(id) => void selectConversation(id)}
        onNewConversation={handleNewConversation}
        newConversationDisabled={navLocked}
        selectDisabled={navLocked}
        loadingList={loadingList}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold">Les Cerveaux</h1>
          <p className="text-sm text-neutral-600">
            Ada and Leo — two perspectives, one conversation.
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
          loading={loadingThread || loadingConversation}
          scrollEndRef={scrollEndRef}
        />
        <ChatInput
          onSend={handleSend}
          disabled={sending || loadingThread || loadingConversation}
          placeholder="Message…"
        />
      </div>
    </div>
  );
}
