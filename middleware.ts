import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Protects playbook API routes. Unauthenticated requests get 401 before handlers run (§16).
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/chat",
    "/api/chat/roy",
    "/api/upload",
    "/api/conversation",
    "/api/conversation/:path*",
    "/api/memory/:path*",
  ],
};
