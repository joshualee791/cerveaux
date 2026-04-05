/** Aligns with playbook messages.role — used for UI labels only in this phase. */
export type MessageRole = "user" | "marie" | "roy";

export type ChatMessageDTO = {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: string;
};
