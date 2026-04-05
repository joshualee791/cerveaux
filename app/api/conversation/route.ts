import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const DEFAULT_TITLE = "New Conversation";

/**
 * Create an empty conversation for testing / reset. No thread list UI — client uses returned id only.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await prisma.conversation.create({
    data: { title: DEFAULT_TITLE },
  });

  return NextResponse.json({
    conversationId: conversation.id,
    title: conversation.title,
  });
}
