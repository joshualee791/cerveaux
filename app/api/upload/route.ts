import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUuid } from "@/lib/chat-helpers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

function isTextLike(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "image/svg+xml"
  ) {
    return true;
  }
  const n = file.name.toLowerCase();
  return /\.(md|txt|csv|json|ts|tsx|js|jsx|mjs|cjs|css|html|htm|yml|yaml|svg|sh|env|gitignore)$/i.test(
    n,
  );
}

async function fileToParsedContent(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  if (!isTextLike(file)) {
    return `[Non-text attachment: ${file.name} — contents not inlined]`;
  }
  if (buf.byteLength > MAX_BYTES) {
    return `[Attachment too large (max ${MAX_BYTES} bytes): ${file.name}]`;
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return `[Could not decode ${file.name} as UTF-8]`;
  }
}

/**
 * Single-file upload for a conversation. Returns upload id for POST /api/chat `uploadIds`.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, {
      status: 400,
    });
  }

  const conversationId = form.get("conversationId");
  const file = form.get("file");

  if (typeof conversationId !== "string" || !isUuid(conversationId)) {
    return NextResponse.json(
      { error: "conversationId is required and must be a UUID" },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES} bytes)` },
      { status: 400 },
    );
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, {
      status: 404,
    });
  }

  const parsedContent = await fileToParsedContent(file);
  const mimeType = file.type || "application/octet-stream";

  const row = await prisma.upload.create({
    data: {
      conversationId,
      filename: file.name || "upload",
      mimeType,
      parsedContent,
    },
  });

  return NextResponse.json({ uploadId: row.id });
}
