import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { callMarie } from "@/lib/marie/call-claude";
import { prisma } from "@/lib/prisma";
import { isUuid, titleFromFirstMessage } from "@/lib/chat-helpers";

export const runtime = "nodejs";

/**
 * Marie path — `POST /api/chat`
 *
 * Canonical thread: Prisma stores a single ordered message list per `conversation_id` (user,
 * marie, roy rows may all appear). We do not persist separate threads per agent.
 *
 * Read path: Claude sees only a projection — `user` + `marie` rows in sequence. `roy` assistant
 * rows are left in the DB for the UI but are not sent to Anthropic (Roy-only context is isolated).
 */

type Body = {
  conversationId?: string | null;
  message?: string;
};

/** Project DB rows for Marie: only `user` and `marie` — Roy replies omitted from Marie’s context. */
function toClaudeMessages(
  rows: { role: string; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "marie") {
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

  const claudeMessages = toClaudeMessages(history);
  if (claudeMessages.length === 0) {
    return NextResponse.json(
      { error: "Internal error: empty history" },
      { status: 500 },
    );
  }

  let marieText: string;
  try {
    marieText = await callMarie(claudeMessages);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const marieSeq = nextSeq + 1;
  await prisma.message.create({
    data: {
      conversationId: convId,
      role: "marie",
      content: marieText,
      sequence: marieSeq,
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
