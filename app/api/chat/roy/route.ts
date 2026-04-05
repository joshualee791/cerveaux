import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { callRoy } from "@/lib/roy/call-openai";
import { prisma } from "@/lib/prisma";
import { isUuid, titleFromFirstMessage } from "@/lib/chat-helpers";

export const runtime = "nodejs";

/**
 * Roy path — `POST /api/chat/roy`
 *
 * Canonical thread: same single `messages` table / conversation as Marie; one chronological
 * history at rest. No per-agent duplicate threads in storage.
 *
 * Read path: OpenAI receives only `user` + `roy` rows in order. Marie assistant rows remain in
 * the DB (and in API responses to the client) but are not passed into Roy’s completion.
 */

type Body = {
  conversationId?: string | null;
  message?: string;
};

/** Project DB rows for Roy: only `user` + `roy` — Marie assistant lines omitted from Roy’s context. */
function toOpenAiTurns(
  rows: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "roy") {
      out.push({ role: "assistant", content: r.content });
    }
  }
  return out;
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

  const lastSeq = await prisma.message.aggregate({
    where: { conversationId: convId },
    _max: { sequence: true },
  });
  const nextSeq = (lastSeq._max.sequence ?? 0) + 1;

  await prisma.message.create({
    data: {
      conversationId: convId,
      role: "user",
      content: raw,
      sequence: nextSeq,
    },
  });

  const history = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  const openAiTurns = toOpenAiTurns(history);
  if (openAiTurns.length === 0) {
    return NextResponse.json(
      { error: "Internal error: empty history" },
      { status: 500 },
    );
  }

  let royText: string;
  try {
    royText = await callRoy(openAiTurns);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const roySeq = nextSeq + 1;
  await prisma.message.create({
    data: {
      conversationId: convId,
      role: "roy",
      content: royText,
      sequence: roySeq,
    },
  });

  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { sequence: "asc" },
  });

  return NextResponse.json({
    conversationId: convId,
    conversationTitle: conversation.title,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sequence: m.sequence,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
