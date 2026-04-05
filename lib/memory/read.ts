import { prisma } from "@/lib/prisma";

export type AgentMemory = {
  joshua: string;
  counterpart: string;
};

/**
 * Read persistent memory for one agent (§10). Missing rows → empty strings; never throws.
 */
export async function getAgentMemory(
  agent: "ada" | "leo",
): Promise<AgentMemory> {
  try {
    const [joshuaRow, counterpartRow] = await Promise.all([
      prisma.memory.findFirst({ where: { agent, scope: "joshua" } }),
      prisma.memory.findFirst({ where: { agent, scope: "counterpart" } }),
    ]);
    return {
      joshua: joshuaRow?.content ?? "",
      counterpart: counterpartRow?.content ?? "",
    };
  } catch (e) {
    console.error("[memory/read]", e);
    return { joshua: "", counterpart: "" };
  }
}
