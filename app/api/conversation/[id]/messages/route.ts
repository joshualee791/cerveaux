import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/chat-helpers";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { sequence: "asc" },
  });

  return NextResponse.json({
    conversationId: conversation.id,
    title: conversation.title,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sequence: m.sequence,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
