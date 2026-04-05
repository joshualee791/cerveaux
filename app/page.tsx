import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat/chat-shell";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }

  const userName = session.user.name ?? "You";

  return <ChatShell userName={userName} />;
}
