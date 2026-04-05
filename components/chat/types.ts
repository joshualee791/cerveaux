/** Aligns with playbook messages.role — used for UI labels only in this phase. */
export type MessageRole = "user" | "marie" | "roy" | "assistant";

export type ChatMessageDTO = {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: string;
  /** Client-only: primary reply streaming in progress */
  streaming?: boolean;
};

/** GET /api/conversations item — optional preview from last message. */
export type ConversationListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
};
