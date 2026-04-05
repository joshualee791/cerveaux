import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAgentMemory } from "@/lib/memory/read";

/** Middle of playbook 10–15 message window: new messages in this conversation since last summary. */
export const MEMORY_SUMMARIZE_MESSAGE_THRESHOLD = 12;

const HAIKU_MODEL =
  process.env.ANTHROPIC_MEMORY_MODEL ??
  process.env.ANTHROPIC_ROUTER_MODEL ??
  "claude-haiku-4-5";

function formatTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      const who =
        m.role === "user"
          ? "Joshua"
          : m.role === "ada"
            ? "Ada"
            : m.role === "leo"
              ? "Leo"
              : m.role;
      return `${who}: ${m.content}`;
    })
    .join("\n\n");
}

function parseMemoryJson(text: string): { joshua: string; counterpart: string } {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No JSON object in summarizer response");
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  const joshua =
    typeof parsed.joshua === "string" ? parsed.joshua : "";
  const counterpart =
    typeof parsed.counterpart === "string" ? parsed.counterpart : "";
  return { joshua, counterpart };
}

function buildSummarizerPrompt(params: {
  agentName: "Ada" | "Leo";
  counterpartName: "Ada" | "Leo";
  currentJoshua: string;
  currentCounterpart: string;
  transcript: string;
}): string {
  return `You are updating persistent memory for ${params.agentName} (this agent's long-term notes — not a transcript summary).

Current memory about Joshua:
${params.currentJoshua || "(empty)"}

Current memory about ${params.counterpartName}:
${params.currentCounterpart || "(empty)"}

New conversation:
${params.transcript}

Your job is to COMPRESS durable signal — not to paraphrase the chat. Each block must stay selective and stable across future turns.

KEEP (when clearly supported by the thread or prior memory):
- Durable preferences, recurring patterns, and interaction style
- Stable project/system or tooling preferences that matter for future turns
- For "counterpart": how ${params.counterpartName} tends to differ from ${params.agentName} in lens or emphasis — useful for coordination, NOT copying their voice or absorbing their role

AVOID:
- Transient moods, one-off jokes, throwaway trivia unless clearly important later
- Over-personal, speculative, or "creepy" inferences about the user
- Redundant restatements of the Joshua context block or obvious facts
- Exaggerated certainty; hedge when inference is thin
- Turning counterpart memory into mimicry of the other agent — describe differences that help ${params.agentName}, not roleplay as the other

If this session adds no important new signal, return the previous memory content for that block (or minimally edit). Do NOT rewrite aggressively when nothing material changed.

Return only valid JSON — no preamble, no markdown:
{ "joshua": "...", "counterpart": "..." }

Keep each block under 500 words. Prioritize signal; cut noise.`;
}

/**
 * Avoid overwriting solid memory with empty or collapsed low-signal model output.
 */
function mergeMemoryField(previous: string, candidate: string): string {
  const next = candidate.trim();
  const prev = previous.trim();
  if (next.length === 0) {
    return previous;
  }
  if (prev.length >= 80 && next.length < 30) {
    console.log("[memory/summarize] mergeMemoryField: kept prior (candidate suspiciously short)", {
      prevLen: prev.length,
      nextLen: next.length,
    });
    return previous;
  }
  return candidate;
}

function mergeAgentMemorySnapshot(
  before: { joshua: string; counterpart: string },
  candidate: { joshua: string; counterpart: string },
): { joshua: string; counterpart: string } {
  return {
    joshua: mergeMemoryField(before.joshua, candidate.joshua),
    counterpart: mergeMemoryField(before.counterpart, candidate.counterpart),
  };
}

async function upsertMemoryRow(
  agent: "ada" | "leo",
  scope: "joshua" | "counterpart",
  content: string,
  messageCount: number,
): Promise<void> {
  const existing = await prisma.memory.findFirst({
    where: { agent, scope },
  });
  if (existing) {
    await prisma.memory.update({
      where: { id: existing.id },
      data: { content, messageCount },
    });
  } else {
    await prisma.memory.create({
      data: { agent, scope, content, messageCount },
    });
  }
}

async function callSummarizerForAgent(params: {
  agent: "ada" | "leo";
  counterpartLabel: "Ada" | "Leo";
  transcript: string;
}): Promise<{ joshua: string; counterpart: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[memory/debug] summarizer aborted: ANTHROPIC_API_KEY missing", {
      agent: params.agent,
    });
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  console.log("[memory/debug] summarizer Haiku request starting", {
    agent: params.agent,
    model: HAIKU_MODEL,
    anthropicApiKeyPresent: true,
    transcriptChars: params.transcript.length,
  });

  const current = await getAgentMemory(params.agent);
  const client = new Anthropic({ apiKey });

  const userPrompt = buildSummarizerPrompt({
    agentName: params.agent === "ada" ? "Ada" : "Leo",
    counterpartName: params.counterpartLabel,
    currentJoshua: current.joshua,
    currentCounterpart: current.counterpart,
    transcript: params.transcript,
  });

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Unexpected summarizer response shape");
  }

  const rawText = block.text;
  console.log("[memory/debug] summarizer response received, parsing JSON", {
    agent: params.agent,
    rawLength: rawText.length,
  });
  try {
    const parsed = parseMemoryJson(rawText);
    console.log("[memory/debug] JSON parse ok", {
      agent: params.agent,
      joshuaLen: parsed.joshua.length,
      counterpartLen: parsed.counterpart.length,
    });
    return parsed;
  } catch (parseErr) {
    console.error("[memory/debug] JSON parse failed", {
      agent: params.agent,
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      rawPreview: rawText.slice(0, 400),
    });
    throw parseErr;
  }
}

/**
 * Fire-and-forget: if this conversation has enough new messages since its last checkpoint,
 * update agent memory for both agents. Never awaited by the chat handler; failures are logged only.
 *
 * Inactivity-based trigger (playbook 5–10 min) is deferred.
 */
export function scheduleMemorySummarization(conversationId: string): void {
  console.log("[memory/debug] scheduleMemorySummarization invoked", {
    conversationId,
  });
  void runMemorySummarization(conversationId)
    .then(() => {
      console.log("[memory/debug] runMemorySummarization promise settled (ok)", {
        conversationId,
      });
    })
    .catch((err) => {
      console.error("[memory/debug] runMemorySummarization promise rejected", err);
      console.error("[memory/summarize]", err);
    });
}

async function runMemorySummarization(conversationId: string): Promise<void> {
  console.log("[memory/debug] runMemorySummarization async entry", {
    conversationId,
    anthropicApiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    summarizerModel: HAIKU_MODEL,
    threshold: MEMORY_SUMMARIZE_MESSAGE_THRESHOLD,
  });

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) {
    console.log("[memory/debug] skip: conversation row not found", {
      conversationId,
    });
    return;
  }

  const convMessageCount = await prisma.message.count({
    where: { conversationId },
  });

  const checkpoint = conversation.memoryCheckpointMessageCount;
  const delta = convMessageCount - checkpoint;
  const passesTrigger = delta >= MEMORY_SUMMARIZE_MESSAGE_THRESHOLD;

  console.log("[memory/debug] trigger evaluation", {
    conversationId,
    convMessageCount,
    memoryCheckpointMessageCount: checkpoint,
    delta,
    threshold: MEMORY_SUMMARIZE_MESSAGE_THRESHOLD,
    passesTrigger,
  });

  if (!passesTrigger) {
    console.log("[memory/debug] skip: threshold not met (no summarization)", {
      conversationId,
    });
    return;
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sequence: "asc" },
  });
  if (messages.length === 0) {
    console.log("[memory/debug] skip: zero messages in thread", {
      conversationId,
    });
    return;
  }

  const transcript = formatTranscript(messages);

  let ada: { joshua: string; counterpart: string };
  let leo: { joshua: string; counterpart: string };

  const memoryBeforeAda = await getAgentMemory("ada");
  const memoryBeforeLeo = await getAgentMemory("leo");

  console.log("[memory/debug] Ada summarization starting", {
    conversationId,
    transcriptChars: transcript.length,
  });
  try {
    const adaRaw = await callSummarizerForAgent({
      agent: "ada",
      counterpartLabel: "Leo",
      transcript,
    });
    ada = mergeAgentMemorySnapshot(memoryBeforeAda, adaRaw);
    console.log("[memory/debug] Ada summarization finished ok", {
      conversationId,
    });
  } catch (e) {
    console.error("[memory/debug] Ada summarization failed", {
      conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error("[memory/summarize] Ada summarization failed", e);
    return;
  }

  console.log("[memory/debug] Leo summarization starting", { conversationId });
  try {
    const leoRaw = await callSummarizerForAgent({
      agent: "leo",
      counterpartLabel: "Ada",
      transcript,
    });
    leo = mergeAgentMemorySnapshot(memoryBeforeLeo, leoRaw);
    console.log("[memory/debug] Leo summarization finished ok", {
      conversationId,
    });
  } catch (e) {
    console.error("[memory/debug] Leo summarization failed", {
      conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error("[memory/summarize] Leo summarization failed", e);
    return;
  }

  console.log("[memory/debug] memory table upserts starting", { conversationId });
  try {
    await upsertMemoryRow("ada", "joshua", ada.joshua, convMessageCount);
    await upsertMemoryRow("ada", "counterpart", ada.counterpart, convMessageCount);
    await upsertMemoryRow("leo", "joshua", leo.joshua, convMessageCount);
    await upsertMemoryRow("leo", "counterpart", leo.counterpart, convMessageCount);
    console.log("[memory/debug] memory table upserts completed", {
      conversationId,
    });
  } catch (e) {
    console.error("[memory/debug] memory upsert failed", {
      conversationId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  console.log("[memory/debug] conversation checkpoint update starting", {
    conversationId,
    nextCheckpoint: convMessageCount,
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { memoryCheckpointMessageCount: convMessageCount },
  });
  console.log("[memory/debug] conversation checkpoint updated", {
    conversationId,
    memoryCheckpointMessageCount: convMessageCount,
  });
}
