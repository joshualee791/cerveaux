import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Returns the single most recently created conversation (by `created_at`) with
 * all messages, or `conversation: null` if none exist.
 * Authoritative for which thread to show on load — no client-side id storage.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const latest = await prisma.conversation.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ conversation: null });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: latest.id },
    orderBy: { sequence: "asc" },
  });

  return NextResponse.json({
    conversation: {
      conversationId: latest.id,
      title: latest.title,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sequence: m.sequence,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
}
