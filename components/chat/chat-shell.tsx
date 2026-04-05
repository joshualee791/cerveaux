import { ChatApp } from "./chat-app";

type Props = {
  userName: string;
};

export function ChatShell({ userName }: Props) {
  return <ChatApp userName={userName} />;
}
