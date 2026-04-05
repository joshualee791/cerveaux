import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PREVIEW_MAX = 100;

function previewFromContent(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= PREVIEW_MAX) return oneLine;
  return `${oneLine.slice(0, PREVIEW_MAX - 1)}…`;
}

/**
 * Lists conversations for the sidebar — most recently updated first.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { sequence: "desc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  return NextResponse.json({
    conversations: rows.map((r) => {
      const last = r.messages[0];
      return {
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        ...(last?.content
          ? { preview: previewFromContent(last.content) }
          : {}),
      };
    }),
  });
}
