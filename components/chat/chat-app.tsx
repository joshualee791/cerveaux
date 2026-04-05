"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatInput } from "./chat-input";
import {
  ConversationSidebar,
  SidebarCollapseToggle,
} from "./conversation-sidebar";
import { MessageThread } from "./message-thread";
import type { ThinkingKind } from "./thinking-indicator";
import type {
  AdaRetryFallbackState,
  ChatMessageDTO,
  ConversationListItem,
} from "./types";

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
const SIDEBAR_KEY = "cerveaux-sidebar-collapsed";

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

function latestUserSequence(msgs: ChatMessageDTO[]): number | null {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === "user") return msgs[i].sequence;
  }
  return null;
}

function isAdaEmptyResponseError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("ada returned no text") ||
    m.includes("ada returned no visible text")
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
  const [thinkingState, setThinkingState] = useState<ThinkingKind | null>(
    null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [adaFallback, setAdaFallback] =
    useState<AdaRetryFallbackState | null>(null);

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const beforeSwitchRef = useRef<{
    conversationId: string | null;
    messages: ChatMessageDTO[];
  } | null>(null);
  const routeRef = useRef<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem(SIDEBAR_KEY, n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });
  }, []);

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
          setAdaFallback(null);
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
        setAdaFallback(null);
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
    setAdaFallback(null);
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
    setAdaFallback(null);
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

  async function handleDeleteConversation(id: string) {
    if (
      !confirm(
        "Delete this conversation? This cannot be undone.",
      )
    ) {
      return;
    }
    setSendError(null);
    setAdaFallback(null);
    try {
      const res = await fetch(
        `/api/conversation/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `Error (${res.status})`,
        );
      }
      await refreshConversations();
      const listRes = await fetch("/api/conversations");
      if (!listRes.ok) {
        throw new Error(`Failed to refresh list (${listRes.status})`);
      }
      const listData = (await listRes.json()) as ConversationsResponse;
      if (id !== conversationId) return;
      if (listData.conversations.length === 0) {
        setConversationId(null);
        setMessages([]);
        return;
      }
      const nextId = listData.conversations[0].id;
      setLoadingConversation(true);
      setMessages([]);
      setConversationId(nextId);
      try {
        const msgRes = await fetch(
          `/api/conversation/${encodeURIComponent(nextId)}/messages`,
        );
        const msgData = (await msgRes.json().catch(() => ({}))) as
          | MessagesResponse
          | { error?: string };
        if (!msgRes.ok) {
          throw new Error(
            typeof (msgData as { error?: string }).error === "string"
              ? (msgData as { error: string }).error
              : `Error (${msgRes.status})`,
          );
        }
        setMessages((msgData as MessagesResponse).messages);
      } catch (e) {
        setSendError(
          e instanceof Error ? e.message : "Could not load conversation.",
        );
        setConversationId(null);
        setMessages([]);
      } finally {
        setLoadingConversation(false);
      }
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Could not delete conversation.",
      );
    }
  }

  async function handleRetryAdaFallback() {
    if (!adaFallback || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    setThinkingState({ kind: "pending" });
    setAdaFallback((prev) => (prev ? { ...prev, retrying: true } : prev));

    let activeRoute: string | null = null;
    let activeStreamingRole: "ada" | "leo" | null = null;
    let sawPrimarySaved = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: adaFallback.conversationId,
          retryAdaLatestUser: true,
        }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
      }

      if (!ct.includes("ndjson") || !res.body) {
        throw new Error("Unexpected response from chat.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (ev: NdjsonEvent) => {
        switch (ev.type) {
          case "start": {
            routeRef.current = ev.route;
            activeRoute = ev.route;
            activeStreamingRole = ev.streamingRole;
            setThinkingState({
              kind: "named",
              agent: ev.streamingRole,
            });
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
            setThinkingState(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__"
                  ? { ...m, content: m.content + ev.text }
                  : m,
              ),
            );
            break;
          case "primary_saved": {
            sawPrimarySaved = true;
            const r = activeRoute;
            if (r === "COMMUNAL_DUAL" || r === "ADA_PRIMARY") {
              setThinkingState({ kind: "named", agent: "leo" });
            } else if (r === "LEO_PRIMARY") {
              setThinkingState({ kind: "named", agent: "ada" });
            } else {
              setThinkingState(null);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__" ? ev.message : m,
              ),
            );
            setAdaFallback(null);
            break;
          }
          case "secondary_saved":
            setThinkingState(null);
            setMessages((prev) => [...prev, ev.message]);
            break;
          case "done":
            setConversationId(ev.conversationId);
            setMessages(ev.messages);
            setAdaFallback(null);
            void refreshConversations();
            break;
          case "error": {
            setThinkingState(null);
            if (
              activeStreamingRole === "ada" &&
              !sawPrimarySaved &&
              isAdaEmptyResponseError(ev.error)
            ) {
              setMessages((prev) => stripOptimistic(prev));
              setAdaFallback((prev) =>
                prev
                  ? { ...prev, retrying: false }
                  : {
                      conversationId: conversationId ?? adaFallback.conversationId,
                      userSequence: adaFallback.userSequence,
                      retrying: false,
                    },
              );
              setSendError(null);
            } else {
              setSendError(ev.error);
              setMessages((prev) => stripOptimistic(prev));
              setAdaFallback((prev) =>
                prev ? { ...prev, retrying: false } : prev,
              );
            }
            break;
          }
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
            throw new Error("Invalid stream data from chat.");
          }
        }
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Retry failed.");
      setAdaFallback((prev) => (prev ? { ...prev, retrying: false } : prev));
      setThinkingState(null);
      setMessages((prev) => stripOptimistic(prev));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function handleSend(text: string, file: File | null) {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;

    sendingRef.current = true;
    setSendError(null);
    setAdaFallback(null);
    setThinkingState({ kind: "pending" });
    setSending(true);

    let conv: string | null = conversationId;
    const uploadIds: string[] = [];

    let activeRoute: string | null = null;
    let activeStreamingRole: "ada" | "leo" | null = null;
    let sawPrimarySaved = false;
    let started = false;
    let activeConversationId: string | null = conv;
    let fallbackUserSequence: number | null = null;

    try {
      if (!conv) {
        const cr = await fetch("/api/conversation", { method: "POST" });
        const cd = (await cr.json().catch(() => ({}))) as {
          conversationId?: string;
          error?: string;
        };
        if (!cr.ok) {
          throw new Error(
            typeof cd.error === "string" ? cd.error : `Error (${cr.status})`,
          );
        }
        if (!cd.conversationId) {
          throw new Error("Invalid response from server.");
        }
        conv = cd.conversationId;
        activeConversationId = conv;
        setConversationId(conv);
        await refreshConversations();
      }

      if (file) {
        const fd = new FormData();
        fd.set("conversationId", conv);
        fd.set("file", file);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        const ud = (await up.json().catch(() => ({}))) as {
          uploadId?: string;
          error?: string;
        };
        if (!up.ok) {
          throw new Error(
            typeof ud.error === "string"
              ? ud.error
              : `Upload failed (${up.status})`,
          );
        }
        if (ud.uploadId) uploadIds.push(ud.uploadId);
      }

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
        ];
      });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conv ?? undefined,
          message: trimmed,
          uploadIds: uploadIds.length ? uploadIds : undefined,
        }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        setMessages((prev) => stripOptimistic(prev));
        setThinkingState(null);
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
      }

      if (!ct.includes("ndjson") || !res.body) {
        setMessages((prev) => stripOptimistic(prev));
        setThinkingState(null);
        throw new Error("Unexpected response from chat.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (ev: NdjsonEvent) => {
        switch (ev.type) {
          case "start": {
            routeRef.current = ev.route;
            activeRoute = ev.route;
            activeStreamingRole = ev.streamingRole;
            activeConversationId = ev.conversationId;
            started = true;
            fallbackUserSequence = latestUserSequence(ev.messages);
            setThinkingState({
              kind: "named",
              agent: ev.streamingRole,
            });
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
            setThinkingState(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__"
                  ? { ...m, content: m.content + ev.text }
                  : m,
              ),
            );
            break;
          case "primary_saved": {
            sawPrimarySaved = true;
            const r = activeRoute;
            if (r === "COMMUNAL_DUAL" || r === "ADA_PRIMARY") {
              setThinkingState({ kind: "named", agent: "leo" });
            } else if (r === "LEO_PRIMARY") {
              setThinkingState({ kind: "named", agent: "ada" });
            } else {
              setThinkingState(null);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "__streaming__" ? ev.message : m,
              ),
            );
            setAdaFallback(null);
            break;
          }
          case "secondary_saved":
            setThinkingState(null);
            setMessages((prev) => [...prev, ev.message]);
            break;
          case "done":
            setConversationId(ev.conversationId);
            setMessages(ev.messages);
            setAdaFallback(null);
            void refreshConversations();
            break;
          case "error": {
            const useFallback =
              started &&
              activeConversationId &&
              fallbackUserSequence !== null &&
              isAdaEmptyResponseError(ev.error) &&
              ((activeStreamingRole === "ada" && !sawPrimarySaved) ||
                (activeRoute === "LEO_PRIMARY" && sawPrimarySaved));

            setThinkingState(null);
            setMessages((prev) => stripOptimistic(prev));

            if (useFallback) {
              setAdaFallback({
                conversationId: activeConversationId ?? conversationId ?? "",
                userSequence: fallbackUserSequence!,
                retrying: false,
              });
              setSendError(null);
            } else {
              setSendError(ev.error);
            }
            break;
          }
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
      setThinkingState(null);
    } finally {
      sendingRef.current = false;
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
        onDeleteConversation={(id) => void handleDeleteConversation(id)}
        collapsed={sidebarCollapsed}
        newConversationDisabled={navLocked}
        selectDisabled={navLocked}
        loadingList={loadingList}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">Les Cerveaux</h1>
            <p className="text-sm text-neutral-600">
              Ada and Leo — two perspectives, one conversation.
            </p>
          </div>
          <SidebarCollapseToggle
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebarCollapsed}
          />
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
          thinkingState={thinkingState}
          showAdaFallback={Boolean(adaFallback)}
          adaRetrying={Boolean(adaFallback?.retrying)}
          onRetryAda={() => void handleRetryAdaFallback()}
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
