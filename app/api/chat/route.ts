import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDeferralPrompt } from "@/lib/deferral";
import { callAda, streamAda } from "@/lib/ada/call-claude";
import { callLeo, streamLeo } from "@/lib/leo/call-openai";
import {
  isUuid,
  lastAssistantRole,
  titleFromFirstMessage,
  toSharedAgentMessages,
} from "@/lib/chat-helpers";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/conversation-defaults";
import { classifyRoute, type RouteLabel } from "@/lib/router/classify";
import {
  buildCommunalSecondaryPrompt,
  COMMUNAL_PRIMARY_APPEND,
  detectCommunalPrompt,
} from "@/lib/router/communal";
import { getAgentMemory } from "@/lib/memory/read";
import { scheduleMemorySummarization } from "@/lib/memory/summarize";
import { prisma } from "@/lib/prisma";
import type { Message } from "@prisma/client";

export const runtime = "nodejs";

const ADA_LIFECYCLE_DEBUG = process.env.ADA_LIFECYCLE_DEBUG === "1";

type AdaPhase =
  | "primary_stream"
  | "secondary_call"
  | "communal_secondary"
  | "leo_primary_deferral";

function newChatTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logChatLifecycle(
  chatTurnId: string,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  if (!ADA_LIFECYCLE_DEBUG) return;
  console.warn(
    "[chat/lifecycle]",
    JSON.stringify({
      chatTurnId,
      event,
      ...payload,
    }),
  );
}

/**
 * Central chat orchestration: router + Ada/Leo + deferral for BOTH.
 * Memory read per agent (§10); summarization scheduled after response (async).
 */

type Body = {
  conversationId?: string | null;
  message?: string;
  /** Upload ids from POST /api/upload for this conversation (Stage 1 UI: one file). */
  uploadIds?: string[];
  /** Retry Ada for latest unsatisfied user turn without creating another user row. */
  retryAdaLatestUser?: boolean;
};

type ChatMessageDTO = {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: string;
};

function priorForRouter(
  role: "ada" | "leo" | null,
): "Ada" | "Leo" | "none" {
  if (role === "ada") return "Ada";
  if (role === "leo") return "Leo";
  return "none";
}

function toDto(m: Message): ChatMessageDTO {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    sequence: m.sequence,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Ensures we never persist whitespace-only assistant text. Returns trimmed content.
 */
function assertHasVisibleAssistantText(label: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    console.warn(
      `[chat] Prevented empty ${label} assistant message (empty or whitespace-only)`,
    );
    throw new Error(`${label} returned no visible text`);
  }
  return trimmed;
}

/** Optional opener so "Hey Leo, …" resolves before global @mentions. */
const LEADING_GREETING = /^(?:Hi|Hey|Hello|Ok|Okay|So|Well)(?:,|\s+)\s*/i;

/**
 * Leading addressee only (after trim). Greeting + Ada/Leo/@ada/@leo at effective start.
 * Checked before global @mention scan so "Leo, … @ada" still targets Leo.
 */
function leadingExplicitAgentTarget(t: string): "ada" | "leo" | null {
  let s = t;
  const gm = t.match(LEADING_GREETING);
  if (gm) {
    s = t.slice(gm[0].length);
  }
  if (!s) return null;

  if (/^@ada\b/i.test(s)) return "ada";
  if (/^@leo\b/i.test(s)) return "leo";

  if (
    /^ada\s*:/i.test(s) ||
    /^ada\s*\?/i.test(s) ||
    /^ada\b/i.test(s)
  ) {
    return "ada";
  }
  if (
    /^leo\s*:/i.test(s) ||
    /^leo\s*\?/i.test(s) ||
    /^leo\b/i.test(s)
  ) {
    return "leo";
  }
  return null;
}

/**
 * Trailing addressee: "…, Leo" / "…, Ada" / "… Leo?" at end (common in questions).
 */
function trailingExplicitAgentTarget(t: string): "ada" | "leo" | null {
  const s = t.trim();
  if (/,+\s*Leo\s*[?.!]?\s*$/i.test(s)) return "leo";
  if (/,+\s*Ada\s*[?.!]?\s*$/i.test(s)) return "ada";
  if (/\bLeo\s*\?\s*$/i.test(s)) return "leo";
  if (/\bAda\s*\?\s*$/i.test(s)) return "ada";
  return null;
}

/**
 * Mid-message direct address: "Leo can you …", "Ada what …" — bounded to avoid
 * casual mentions ("Leo can swim"). Runs after @mentions per priority order.
 */
function naturalAddressExplicitTarget(t: string): "ada" | "leo" | null {
  const re =
    /\b(leo|ada)\b,?\s+(?:can\s+you|could\s+you|would\s+you|will\s+you|would\s+you\s+mind|what|how|please|do\s+you|did\s+you)\b/gi;
  const m = re.exec(t);
  if (!m) return null;
  return m[1].toLowerCase() === "leo" ? "leo" : "ada";
}

/**
 * Deterministic explicit addressee — overrides Haiku classification when set.
 * Priority: leading address; trailing ", Leo" / ", Ada"; @ada/@leo;
 * natural mid-message direct address (e.g. "lol well done. Leo can you …").
 */
function explicitAgentTarget(raw: string): "ada" | "leo" | null {
  const t = raw.trim();
  if (!t) return null;

  const leading = leadingExplicitAgentTarget(t);
  if (leading) return leading;

  const trailing = trailingExplicitAgentTarget(t);
  if (trailing) return trailing;

  const idxAda = t.search(/@ada\b/i);
  const idxLeo = t.search(/@leo\b/i);
  if (idxAda >= 0 || idxLeo >= 0) {
    if (idxLeo === -1 || (idxAda >= 0 && idxAda <= idxLeo)) {
      return "ada";
    }
    return "leo";
  }

  const natural = naturalAddressExplicitTarget(t);
  if (natural) return natural;

  return null;
}

function ndjsonResponse(
  run: (send: (obj: Record<string, unknown>) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(obj)}\n`),
          );
        };
        try {
          await run(send);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "LLM request failed";
          send({ type: "error", error: msg });
        } finally {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const retryAdaLatestUser = body.retryAdaLatestUser === true;
  const raw = body.message?.trim() ?? "";
  if (!retryAdaLatestUser && !raw) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const chatTurnId = newChatTurnId();

  const requestedId =
    body.conversationId && isUuid(body.conversationId)
      ? body.conversationId
      : null;

  if (retryAdaLatestUser && !requestedId) {
    return NextResponse.json(
      { error: "conversationId is required for Ada retry" },
      { status: 400 },
    );
  }

  let conversation = requestedId
    ? await prisma.conversation.findUnique({ where: { id: requestedId } })
    : null;

  if (!conversation && !retryAdaLatestUser) {
    conversation = await prisma.conversation.create({
      data: { title: titleFromFirstMessage(raw) },
    });
  }

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const convId = conversation.id;

  const existing = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  let userSeq: number;
  let route: RouteLabel;
  let targeted: "ada" | "leo" | null = null;

  if (retryAdaLatestUser) {
    let lastUser: Message | null = null;
    for (let i = existing.length - 1; i >= 0; i -= 1) {
      if (existing[i].role === "user") {
        lastUser = existing[i];
        break;
      }
    }

    if (!lastUser) {
      return NextResponse.json(
        { error: "No user turn found to retry Ada for" },
        { status: 409 },
      );
    }

    const hasAdaAfter = existing.some(
      (m) => m.sequence > lastUser.sequence && m.role === "ada",
    );
    if (hasAdaAfter) {
      return NextResponse.json(
        { error: "Ada retry target already has an Ada response" },
        { status: 409 },
      );
    }

    const maxExistingSeqAfterUser = existing.reduce((max, m) => {
      if (m.sequence > lastUser.sequence) {
        return Math.max(max, m.sequence);
      }
      return max;
    }, lastUser.sequence);

    // Primary save uses userSeq + 1; place retry after any already-persisted assistant rows.
    userSeq = maxExistingSeqAfterUser;
    route = "ADA_ONLY";
  } else {
    const lastAssist = lastAssistantRole(existing);
    const prior = priorForRouter(lastAssist);

    const lastSeq = await prisma.message.aggregate({
      where: { conversationId: convId },
      _max: { sequence: true },
    });
    userSeq = (lastSeq._max.sequence ?? 0) + 1;

    const uploadIds = Array.isArray(body.uploadIds)
      ? body.uploadIds
          .filter(
            (id): id is string => typeof id === "string" && isUuid(id),
          )
          .slice(0, 1)
      : [];

    let storedContent = raw;
    if (uploadIds.length > 0) {
      const uploads = await prisma.upload.findMany({
        where: {
          id: { in: uploadIds },
          conversationId: convId,
        },
      });
      const byId = new Map(uploads.map((u) => [u.id, u]));
      for (const uid of uploadIds) {
        const u = byId.get(uid);
        if (!u) continue;
        storedContent += `

---
Attached: ${u.filename}
---
${u.parsedContent}`;
      }
    }

    await prisma.message.create({
      data: {
        conversationId: convId,
        role: "user",
        content: storedContent,
        sequence: userSeq,
      },
    });

    targeted = explicitAgentTarget(raw);

    if (targeted === "ada") {
      route = "ADA_ONLY";
    } else if (targeted === "leo") {
      route = "LEO_ONLY";
    } else if (detectCommunalPrompt(raw)) {
      route = "COMMUNAL_DUAL";
    } else {
      try {
        route = await classifyRoute(raw, prior);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Router failed";
        return NextResponse.json({ error: msg }, { status: 502 });
      }
    }
  }

  const streamingRole: "ada" | "leo" =
    route === "ADA_ONLY" ||
    route === "ADA_PRIMARY" ||
    route === "COMMUNAL_DUAL"
      ? "ada"
      : "leo";

  const executingPrimary =
    route === "ADA_ONLY" ||
    route === "ADA_PRIMARY" ||
    route === "COMMUNAL_DUAL"
      ? "streamAda"
      : "streamLeo";
  console.log("[router/debug]", {
    explicitTarget:
      targeted === null ? null : targeted === "ada" ? "ADA" : "LEO",
    finalRoute: route,
    executing: executingPrimary,
    streamingRole,
    classifierSkipped: targeted !== null || route === "COMMUNAL_DUAL",
    communalDual: route === "COMMUNAL_DUAL",
  });

  logChatLifecycle(chatTurnId, "turn_initialized", {
    conversationId: convId,
    route,
    streamingRole,
    executingPrimary,
    retryAdaLatestUser,
  });

  return ndjsonResponse(async (send) => {
    let primaryDeltaCount = 0;
    let sawPrimaryDelta = false;
    const assistantRowsCreated: Array<{
      id: string;
      role: string;
      sequence: number;
      phase: AdaPhase | "other";
      contentLength: number;
    }> = [];

    const historyForModel = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { sequence: "asc" },
    });

    const lastRow = historyForModel[historyForModel.length - 1];
    const preview =
      lastRow?.content
        .slice(0, 120)
        .replace(/\s+/g, " ")
        .trim() ?? "";
    console.log("[history/debug]", {
      conversationId: convId,
      messageCount: historyForModel.length,
      lastMessageRole: lastRow?.role ?? null,
      lastMessageSequence: lastRow?.sequence ?? null,
      lastMessagePreview: preview,
    });

    const startMessages: ChatMessageDTO[] = historyForModel.map(toDto);

    console.log("[context/debug]", {
      conversationId: convId,
      dbMessageCount: historyForModel.length,
    });

    logChatLifecycle(chatTurnId, "start_emitted", {
      phase: "primary_stream",
      conversationId: convId,
      route,
      streamingRole,
      startMessageCount: startMessages.length,
    });

    send({
      type: "start",
      conversationId: convId,
      conversationTitle: conversation.title,
      route,
      streamingRole,
      messages: startMessages,
    });

    const onDelta = (text: string) => {
      primaryDeltaCount += 1;
      if (!sawPrimaryDelta) {
        sawPrimaryDelta = true;
        logChatLifecycle(chatTurnId, "text_delta_begin", {
          phase: "primary_stream",
          streamingRole,
          firstDeltaLength: text.length,
        });
      }
      send({ type: "delta", text });
    };

    const primaryMem = await getAgentMemory(streamingRole);

    let primaryText: string;
    if (
      route === "ADA_ONLY" ||
      route === "ADA_PRIMARY" ||
      route === "COMMUNAL_DUAL"
    ) {
      const claudeMessages = toSharedAgentMessages(historyForModel);
      if (claudeMessages.length === 0) {
        throw new Error("Internal error: empty Ada context");
      }
      primaryText = await streamAda(claudeMessages, {
        onDelta,
        memory: primaryMem,
        systemAppend:
          route === "COMMUNAL_DUAL" ? COMMUNAL_PRIMARY_APPEND : undefined,
        debug: {
          enabled: ADA_LIFECYCLE_DEBUG,
          chatTurnId,
          phase: "primary_stream",
        },
      });
    } else {
      const turns = toSharedAgentMessages(historyForModel);
      if (turns.length === 0) {
        throw new Error("Internal error: empty Leo context");
      }
      primaryText = await streamLeo(turns, {
        onDelta,
        memory: primaryMem,
      });
    }

    const primaryContent = assertHasVisibleAssistantText(
      streamingRole === "ada" ? "Ada" : "Leo",
      primaryText,
    );

    const primaryRole = streamingRole;
    logChatLifecycle(chatTurnId, "assistant_row_create_attempt", {
      phase: "primary_stream",
      role: primaryRole,
      sequence: userSeq + 1,
      contentLength: primaryContent.length,
    });

    const primaryRow = await prisma.message.create({
      data: {
        conversationId: convId,
        role: primaryRole,
        content: primaryContent,
        sequence: userSeq + 1,
      },
    });

    assistantRowsCreated.push({
      id: primaryRow.id,
      role: primaryRow.role,
      sequence: primaryRow.sequence,
      phase: "primary_stream",
      contentLength: primaryRow.content.length,
    });

    logChatLifecycle(chatTurnId, "assistant_row_created", {
      phase: "primary_stream",
      role: primaryRow.role,
      rowId: primaryRow.id,
      sequence: primaryRow.sequence,
      contentLength: primaryRow.content.length,
    });

    logChatLifecycle(chatTurnId, "primary_saved_emitted", {
      phase: "primary_stream",
      role: primaryRow.role,
      rowId: primaryRow.id,
      sequence: primaryRow.sequence,
    });

    send({ type: "primary_saved", message: toDto(primaryRow) });

    if (route === "COMMUNAL_DUAL") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const leoTurns = toSharedAgentMessages(h2);
      if (leoTurns.length === 0) {
        throw new Error("Internal error: empty Leo context after communal Ada");
      }
      const leoMem = await getAgentMemory("leo");
      const leoText = await callLeo(leoTurns, {
        systemAppend: buildCommunalSecondaryPrompt("Ada"),
        memory: leoMem,
      });
      try {
        const leoContent = assertHasVisibleAssistantText("Leo", leoText);
        logChatLifecycle(chatTurnId, "assistant_row_create_attempt", {
          phase: "communal_secondary",
          role: "leo",
          sequence: userSeq + 2,
          contentLength: leoContent.length,
        });

        const leoRow = await prisma.message.create({
          data: {
            conversationId: convId,
            role: "leo",
            content: leoContent,
            sequence: userSeq + 2,
          },
        });

        assistantRowsCreated.push({
          id: leoRow.id,
          role: leoRow.role,
          sequence: leoRow.sequence,
          phase: "communal_secondary",
          contentLength: leoRow.content.length,
        });

        logChatLifecycle(chatTurnId, "assistant_row_created", {
          phase: "communal_secondary",
          role: leoRow.role,
          rowId: leoRow.id,
          sequence: leoRow.sequence,
          contentLength: leoRow.content.length,
        });

        logChatLifecycle(chatTurnId, "secondary_saved_emitted", {
          phase: "communal_secondary",
          role: leoRow.role,
          rowId: leoRow.id,
          sequence: leoRow.sequence,
        });

        send({ type: "secondary_saved", message: toDto(leoRow) });
      } catch (e) {
        console.warn("[chat] Communal dual: skipped empty Leo secondary", e);
        send({
          type: "error",
          error:
            e instanceof Error
              ? e.message
              : "Leo did not return a second perspective.",
        });
      }
    }

    if (route === "ADA_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Ada", primaryContent);
      const leoTurns = toSharedAgentMessages(h2);
      if (leoTurns.length === 0) {
        throw new Error("Internal error: empty Leo context after Ada");
      }
      const leoMem = await getAgentMemory("leo");
      const leoText = await callLeo(leoTurns, {
        systemAppend: deferral,
        memory: leoMem,
      });
      try {
        const leoContent = assertHasVisibleAssistantText("Leo", leoText);
        logChatLifecycle(chatTurnId, "assistant_row_create_attempt", {
          phase: "secondary_call",
          role: "leo",
          sequence: userSeq + 2,
          contentLength: leoContent.length,
        });

        const leoRow = await prisma.message.create({
          data: {
            conversationId: convId,
            role: "leo",
            content: leoContent,
            sequence: userSeq + 2,
          },
        });

        assistantRowsCreated.push({
          id: leoRow.id,
          role: leoRow.role,
          sequence: leoRow.sequence,
          phase: "secondary_call",
          contentLength: leoRow.content.length,
        });

        logChatLifecycle(chatTurnId, "assistant_row_created", {
          phase: "secondary_call",
          role: leoRow.role,
          rowId: leoRow.id,
          sequence: leoRow.sequence,
          contentLength: leoRow.content.length,
        });

        logChatLifecycle(chatTurnId, "secondary_saved_emitted", {
          phase: "secondary_call",
          role: leoRow.role,
          rowId: leoRow.id,
          sequence: leoRow.sequence,
        });

        send({ type: "secondary_saved", message: toDto(leoRow) });
      } catch (e) {
        console.warn("[chat] Ada primary: skipped empty Leo deferral", e);
        send({
          type: "error",
          error:
            e instanceof Error
              ? e.message
              : "Leo did not return a deferral response.",
        });
      }
    }

    if (route === "LEO_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Leo", primaryContent);
      const claudeMessages = toSharedAgentMessages(h2);
      if (claudeMessages.length === 0) {
        throw new Error("Internal error: empty Ada context after Leo");
      }
      const adaMem = await getAgentMemory("ada");
      const adaText = await callAda(claudeMessages, {
        systemAppend: deferral,
        memory: adaMem,
        debug: {
          enabled: ADA_LIFECYCLE_DEBUG,
          chatTurnId,
          phase: "leo_primary_deferral",
        },
      });
      try {
        const adaContent = assertHasVisibleAssistantText("Ada", adaText);
        logChatLifecycle(chatTurnId, "assistant_row_create_attempt", {
          phase: "leo_primary_deferral",
          role: "ada",
          sequence: userSeq + 2,
          contentLength: adaContent.length,
        });

        const adaRow = await prisma.message.create({
          data: {
            conversationId: convId,
            role: "ada",
            content: adaContent,
            sequence: userSeq + 2,
          },
        });

        assistantRowsCreated.push({
          id: adaRow.id,
          role: adaRow.role,
          sequence: adaRow.sequence,
          phase: "leo_primary_deferral",
          contentLength: adaRow.content.length,
        });

        logChatLifecycle(chatTurnId, "assistant_row_created", {
          phase: "leo_primary_deferral",
          role: adaRow.role,
          rowId: adaRow.id,
          sequence: adaRow.sequence,
          contentLength: adaRow.content.length,
        });

        logChatLifecycle(chatTurnId, "secondary_saved_emitted", {
          phase: "leo_primary_deferral",
          role: adaRow.role,
          rowId: adaRow.id,
          sequence: adaRow.sequence,
        });

        send({ type: "secondary_saved", message: toDto(adaRow) });
      } catch (e) {
        console.warn("[chat] Leo primary: skipped empty Ada deferral", e);
        send({
          type: "error",
          error:
            e instanceof Error
              ? e.message
              : "Ada did not return a deferral response.",
        });
      }
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { sequence: "asc" },
    });

    const nextTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE
        ? titleFromFirstMessage(raw)
        : conversation.title;

    const updatedConversation = await prisma.conversation.update({
      where: { id: convId },
      data: { title: nextTitle },
    });

    const adaRowsCreated = assistantRowsCreated.filter((r) => r.role === "ada");

    logChatLifecycle(chatTurnId, "turn_summary", {
      conversationId: convId,
      route,
      streamingRole,
      primaryDeltaCount,
      visibleSourcePrimary:
        primaryDeltaCount > 0 ? "streamed_buffer_then_db_row" : "db_row_only",
      assistantRowsCreated,
      adaRowsCreatedCount: adaRowsCreated.length,
    });

    send({
      type: "done",
      conversationId: convId,
      conversationTitle: updatedConversation.title,
      messages: messages.map(toDto),
    });

    scheduleMemorySummarization(convId);
  });
}
