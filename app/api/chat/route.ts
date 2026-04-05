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

/**
 * Central chat orchestration: router + Ada/Leo + deferral for BOTH.
 * Memory read per agent (§10); summarization scheduled after response (async).
 */

type Body = {
  conversationId?: string | null;
  message?: string;
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

  const raw = body.message?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const requestedId =
    body.conversationId && isUuid(body.conversationId)
      ? body.conversationId
      : null;

  let conversation = requestedId
    ? await prisma.conversation.findUnique({ where: { id: requestedId } })
    : null;

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { title: titleFromFirstMessage(raw) },
    });
  }

  const convId = conversation.id;

  const existing = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  const lastAssist = lastAssistantRole(existing);
  const prior = priorForRouter(lastAssist);

  const lastSeq = await prisma.message.aggregate({
    where: { conversationId: convId },
    _max: { sequence: true },
  });
  const userSeq = (lastSeq._max.sequence ?? 0) + 1;

  await prisma.message.create({
    data: {
      conversationId: convId,
      role: "user",
      content: raw,
      sequence: userSeq,
    },
  });

  const targeted = explicitAgentTarget(raw);

  let route: RouteLabel;
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

  return ndjsonResponse(async (send) => {
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

    send({
      type: "start",
      conversationId: convId,
      conversationTitle: conversation.title,
      route,
      streamingRole,
      messages: startMessages,
    });

    const onDelta = (text: string) => {
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

    const primaryRole = streamingRole;
    const primaryRow = await prisma.message.create({
      data: {
        conversationId: convId,
        role: primaryRole,
        content: primaryText,
        sequence: userSeq + 1,
      },
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
      const leoRow = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "leo",
          content: leoText,
          sequence: userSeq + 2,
        },
      });
      send({ type: "secondary_saved", message: toDto(leoRow) });
    }

    if (route === "ADA_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Ada", primaryText);
      const leoTurns = toSharedAgentMessages(h2);
      if (leoTurns.length === 0) {
        throw new Error("Internal error: empty Leo context after Ada");
      }
      const leoMem = await getAgentMemory("leo");
      const leoText = await callLeo(leoTurns, {
        systemAppend: deferral,
        memory: leoMem,
      });
      const leoRow = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "leo",
          content: leoText,
          sequence: userSeq + 2,
        },
      });
      send({ type: "secondary_saved", message: toDto(leoRow) });
    }

    if (route === "LEO_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Leo", primaryText);
      const claudeMessages = toSharedAgentMessages(h2);
      if (claudeMessages.length === 0) {
        throw new Error("Internal error: empty Ada context after Leo");
      }
      const adaMem = await getAgentMemory("ada");
      const adaText = await callAda(claudeMessages, {
        systemAppend: deferral,
        memory: adaMem,
      });
      const adaRow = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "ada",
          content: adaText,
          sequence: userSeq + 2,
        },
      });
      send({ type: "secondary_saved", message: toDto(adaRow) });
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

    send({
      type: "done",
      conversationId: convId,
      conversationTitle: updatedConversation.title,
      messages: messages.map(toDto),
    });

    scheduleMemorySummarization(convId);
  });
}
