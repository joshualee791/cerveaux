import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDeferralPrompt } from "@/lib/deferral";
import { callMarie, streamMarie } from "@/lib/marie/call-claude";
import { callRoy, streamRoy } from "@/lib/roy/call-openai";
import {
  isUuid,
  lastAssistantRole,
  titleFromFirstMessage,
  toClaudeMessages,
  toOpenAiTurns,
} from "@/lib/chat-helpers";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/conversation-defaults";
import { classifyRoute, type RouteLabel } from "@/lib/router/classify";
import {
  buildCrossAgentReferenceContextAppend,
  detectCrossAgentReference,
  recentReferencedAgentContextWindow,
} from "@/lib/router/cross-agent-reference";
import { getAgentMemory } from "@/lib/memory/read";
import { scheduleMemorySummarization } from "@/lib/memory/summarize";
import { prisma } from "@/lib/prisma";
import type { Message } from "@prisma/client";

export const runtime = "nodejs";

/**
 * Central chat orchestration: router + Marie/Roy + deferral for BOTH.
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
  role: "marie" | "roy" | null,
): "Marie" | "Roy" | "none" {
  if (role === "marie") return "Marie";
  if (role === "roy") return "Roy";
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

/** Optional opener so "Hey Roy, …" resolves before global @mentions. */
const LEADING_GREETING = /^(?:Hi|Hey|Hello|Ok|Okay|So|Well)(?:,|\s+)\s*/i;

/**
 * Leading addressee only (after trim). Greeting + Marie/Roy/@marie/@roy at effective start.
 * Checked before global @mention scan so "Roy, … @marie" still targets Roy.
 */
function leadingExplicitAgentTarget(t: string): "marie" | "roy" | null {
  let s = t;
  const gm = t.match(LEADING_GREETING);
  if (gm) {
    s = t.slice(gm[0].length);
  }
  if (!s) return null;

  if (/^@marie\b/i.test(s)) return "marie";
  if (/^@roy\b/i.test(s)) return "roy";

  if (
    /^marie\s*:/i.test(s) ||
    /^marie\s*\?/i.test(s) ||
    /^marie\b/i.test(s)
  ) {
    return "marie";
  }
  if (
    /^roy\s*:/i.test(s) ||
    /^roy\s*\?/i.test(s) ||
    /^roy\b/i.test(s)
  ) {
    return "roy";
  }
  return null;
}

/**
 * Deterministic explicit addressee — overrides Haiku classification when set.
 * Leading address (incl. greeting + Marie/Roy) first; else global @marie/@roy by first occurrence.
 */
function explicitAgentTarget(raw: string): "marie" | "roy" | null {
  const t = raw.trim();
  if (!t) return null;

  const leading = leadingExplicitAgentTarget(t);
  if (leading) return leading;

  const idxMarie = t.search(/@marie\b/i);
  const idxRoy = t.search(/@roy\b/i);
  if (idxMarie >= 0 || idxRoy >= 0) {
    if (idxRoy === -1 || (idxMarie >= 0 && idxMarie <= idxRoy)) {
      return "marie";
    }
    return "roy";
  }

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
  if (targeted === "marie") {
    route = "MARIE_ONLY";
  } else if (targeted === "roy") {
    route = "ROY_ONLY";
  } else {
    try {
      route = await classifyRoute(raw, prior);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Router failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  const historyAfterUser = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  const streamingRole: "marie" | "roy" =
    route === "MARIE_ONLY" || route === "MARIE_PRIMARY" ? "marie" : "roy";

  const executingPrimary =
    route === "MARIE_ONLY" || route === "MARIE_PRIMARY"
      ? "streamMarie"
      : "streamRoy";
  console.log("[router/debug]", {
    explicitTarget:
      targeted === null ? null : targeted === "marie" ? "MARIE" : "ROY",
    finalRoute: route,
    executing: executingPrimary,
    streamingRole,
    classifierSkipped: targeted !== null,
  });

  const startMessages: ChatMessageDTO[] = historyAfterUser.map(toDto);

  return ndjsonResponse(async (send) => {
    let crossAgentAppend: string | undefined;
    if (
      (route === "MARIE_ONLY" || route === "ROY_ONLY") &&
      targeted &&
      targeted === streamingRole
    ) {
      const referenced = detectCrossAgentReference(raw, streamingRole);
      if (referenced) {
        const refWindow = recentReferencedAgentContextWindow(
          historyAfterUser,
          referenced,
        );
        crossAgentAppend = buildCrossAgentReferenceContextAppend(
          referenced,
          refWindow.map((m) => ({
            sequence: m.sequence,
            content: m.content,
          })),
        );
      }
    }

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
    if (route === "MARIE_ONLY" || route === "MARIE_PRIMARY") {
      const claudeMessages = toClaudeMessages(historyAfterUser);
      if (claudeMessages.length === 0) {
        throw new Error("Internal error: empty Marie context");
      }
      primaryText = await streamMarie(claudeMessages, {
        onDelta,
        memory: primaryMem,
        systemAppend: crossAgentAppend,
      });
    } else {
      const turns = toOpenAiTurns(historyAfterUser);
      if (turns.length === 0) {
        throw new Error("Internal error: empty Roy context");
      }
      primaryText = await streamRoy(turns, {
        onDelta,
        memory: primaryMem,
        systemAppend: crossAgentAppend,
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

    if (route === "MARIE_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Marie", primaryText);
      const royTurns = toOpenAiTurns(h2);
      if (royTurns.length === 0) {
        throw new Error("Internal error: empty Roy context after Marie");
      }
      const royMem = await getAgentMemory("roy");
      const royText = await callRoy(royTurns, {
        systemAppend: deferral,
        memory: royMem,
      });
      const royRow = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "roy",
          content: royText,
          sequence: userSeq + 2,
        },
      });
      send({ type: "secondary_saved", message: toDto(royRow) });
    }

    if (route === "ROY_PRIMARY") {
      const h2 = await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { sequence: "asc" },
      });
      const deferral = buildDeferralPrompt("Roy", primaryText);
      const claudeMessages = toClaudeMessages(h2);
      if (claudeMessages.length === 0) {
        throw new Error("Internal error: empty Marie context after Roy");
      }
      const marieMem = await getAgentMemory("marie");
      const marieText = await callMarie(claudeMessages, {
        systemAppend: deferral,
        memory: marieMem,
      });
      const marieRow = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "marie",
          content: marieText,
          sequence: userSeq + 2,
        },
      });
      send({ type: "secondary_saved", message: toDto(marieRow) });
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
