import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDeferralPrompt } from "@/lib/deferral";
import { callMarie } from "@/lib/marie/call-claude";
import { callRoy } from "@/lib/roy/call-openai";
import {
  isUuid,
  lastAssistantRole,
  titleFromFirstMessage,
  toClaudeMessages,
  toOpenAiTurns,
} from "@/lib/chat-helpers";
import { classifyRoute } from "@/lib/router/classify";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Central chat orchestration (Phase 6): router (Haiku) + Marie/Roy + deferral for BOTH.
 * Canonical thread in `messages`; LLM inputs use role-filtered projections; deferral injects
 * primary text via system append only for the secondary call (§5).
 */

type Body = {
  conversationId?: string | null;
  message?: string;
};

function priorForRouter(
  role: "marie" | "roy" | null,
): "Marie" | "Roy" | "none" {
  if (role === "marie") return "Marie";
  if (role === "roy") return "Roy";
  return "none";
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

  const runMarieOnly = async () => {
    const claudeMessages = toClaudeMessages(historyAfterUser);
    if (claudeMessages.length === 0) {
      throw new Error("Internal error: empty Marie context");
    }
    return callMarie(claudeMessages);
  };

  const runRoyOnly = async () => {
    const turns = toOpenAiTurns(historyAfterUser);
    if (turns.length === 0) {
      throw new Error("Internal error: empty Roy context");
    }
    return callRoy(turns);
  };

  try {
    switch (route) {
      case "MARIE_ONLY": {
        const marieText = await runMarieOnly();
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "marie",
            content: marieText,
            sequence: userSeq + 1,
          },
        });
        break;
      }
      case "ROY_ONLY": {
        const royText = await runRoyOnly();
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "roy",
            content: royText,
            sequence: userSeq + 1,
          },
        });
        break;
      }
      case "MARIE_PRIMARY": {
        const marieText = await runMarieOnly();
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "marie",
            content: marieText,
            sequence: userSeq + 1,
          },
        });
        const h2 = await prisma.message.findMany({
          where: { conversationId: convId },
          orderBy: { sequence: "asc" },
        });
        const deferral = buildDeferralPrompt("Marie", marieText);
        const royTurns = toOpenAiTurns(h2);
        if (royTurns.length === 0) {
          throw new Error("Internal error: empty Roy context after Marie");
        }
        const royText = await callRoy(royTurns, { systemAppend: deferral });
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "roy",
            content: royText,
            sequence: userSeq + 2,
          },
        });
        break;
      }
      case "ROY_PRIMARY": {
        const royText = await runRoyOnly();
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "roy",
            content: royText,
            sequence: userSeq + 1,
          },
        });
        const h2 = await prisma.message.findMany({
          where: { conversationId: convId },
          orderBy: { sequence: "asc" },
        });
        const deferral = buildDeferralPrompt("Roy", royText);
        const claudeMessages = toClaudeMessages(h2);
        if (claudeMessages.length === 0) {
          throw new Error("Internal error: empty Marie context after Roy");
        }
        const marieText = await callMarie(claudeMessages, {
          systemAppend: deferral,
        });
        await prisma.message.create({
          data: {
            conversationId: convId,
            role: "marie",
            content: marieText,
            sequence: userSeq + 2,
          },
        });
        break;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  return NextResponse.json({
    conversationId: convId,
    conversationTitle: conversation.title,
    route,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sequence: m.sequence,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
