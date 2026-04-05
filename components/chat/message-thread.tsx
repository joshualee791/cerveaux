"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MessageRow } from "./message-row";
import { ThinkingIndicator, type ThinkingKind } from "./thinking-indicator";
import { AdaFallbackRow } from "./ada-fallback-row";
import type { ChatMessageDTO } from "./types";
import type { MessageRole } from "./types";

function roleForUi(role: string): MessageRole | null {
  if (
    role === "user" ||
    role === "ada" ||
    role === "leo" ||
    role === "assistant"
  )
    return role;
  return null;
}

/** Hide persisted assistant rows with no visible text (defense in depth vs empty DB rows). */
function shouldRenderMessage(m: ChatMessageDTO): boolean {
  const streaming = m.id === "__streaming__" || Boolean(m.streaming);
  if (streaming) return true;
  const assistant =
    m.role === "ada" || m.role === "leo" || m.role === "assistant";
  if (assistant && !m.content.trim()) return false;
  return true;
}

type Props = {
  userName: string;
  messages: ChatMessageDTO[];
  loading?: boolean;
  scrollEndRef?: RefObject<HTMLDivElement | null>;
  thinkingState?: ThinkingKind | null;
  showAdaFallback?: boolean;
  adaRetrying?: boolean;
  onRetryAda?: () => void;
};

const NEAR_BOTTOM_PX = 120;

export function MessageThread({
  userName,
  messages,
  loading,
  scrollEndRef,
  thinkingState,
  showAdaFallback,
  adaRetrying,
  onRetryAda,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);

  const checkNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return (
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    );
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    scrollEndRef?.current?.scrollIntoView({ behavior });
  }, [scrollEndRef]);

  useEffect(() => {
    if (!stickToBottom) {
      setShowJump(!checkNearBottom());
      return;
    }
    scrollToBottom("smooth");
  }, [messages, thinkingState, stickToBottom, checkNearBottom, scrollToBottom]);

  const onScroll = useCallback(() => {
    const near = checkNearBottom();
    setStickToBottom(near);
    setShowJump(!near);
  }, [checkNearBottom]);

  const onJumpLatest = useCallback(() => {
    setStickToBottom(true);
    setShowJump(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={onScroll}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : null}
          {!loading && messages.length === 0 ? (
            <p className="text-sm text-neutral-600">Send a message to start.</p>
          ) : null}
          {messages.map((m) => {
            if (!shouldRenderMessage(m)) return null;
            const r = roleForUi(m.role);
            if (!r) return null;
            return (
              <MessageRow
                key={m.id}
                role={r}
                content={m.content}
                userName={userName}
                isStreaming={
                  m.id === "__streaming__" || Boolean(m.streaming)
                }
              />
            );
          })}
          {showAdaFallback && onRetryAda ? (
            <AdaFallbackRow retrying={adaRetrying} onRetry={onRetryAda} />
          ) : null}
          {thinkingState ? (
            <ThinkingIndicator state={thinkingState} />
          ) : null}
          {scrollEndRef ? <div ref={scrollEndRef} /> : null}
        </div>
      </div>
      {showJump ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={onJumpLatest}
            className="pointer-events-auto rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-md hover:bg-neutral-50"
          >
            Jump to latest
          </button>
        </div>
      ) : null}
    </div>
  );
}
