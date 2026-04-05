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
import { classifyRoute } from "@/lib/router/classify";
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

  let route: Awaited<ReturnType<typeof classifyRoute>>;
  try {
    route = await classifyRoute(raw, prior);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Router failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const historyAfterUser = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  const streamingRole: "marie" | "roy" =
    route === "MARIE_ONLY" || route === "MARIE_PRIMARY" ? "marie" : "roy";

  const startMessages: ChatMessageDTO[] = historyAfterUser.map(toDto);

  return ndjsonResponse(async (send) => {
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
      });
    } else {
      const turns = toOpenAiTurns(historyAfterUser);
      if (turns.length === 0) {
        throw new Error("Internal error: empty Roy context");
      }
      primaryText = await streamRoy(turns, { onDelta, memory: primaryMem });
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

    send({
      type: "done",
      conversationId: convId,
      conversationTitle: conversation.title,
      messages: messages.map(toDto),
    });

    scheduleMemorySummarization(convId);
  });
}
