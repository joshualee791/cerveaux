import Anthropic, { APIError } from "@anthropic-ai/sdk";
import {
  buildAdaSystemPrompt,
  type AdaMemoryInjection,
} from "@/lib/prompts/ada-system";
import { LABELED_THREAD_GUIDANCE } from "@/lib/prompts/labeled-thread";
import {
  assistantTextFromClaudeMessage,
  extractAssistantText,
  summarizeClaudeResponseForLog,
} from "@/lib/ada/parse-claude-response";
import { reconcileAdaStreamText } from "@/lib/ada/reconcile-ada-stream-text";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type ClaudeTurn = { role: "user" | "assistant"; content: string };

type AdaDebugContext = {
  enabled?: boolean;
  chatTurnId?: string;
  phase?: string;
};


function withLabeledThreadSystem(
  basePrompt: string,
  systemAppend?: string,
): string {
  const core = `${basePrompt}\n\n${LABELED_THREAD_GUIDANCE}`;
  return systemAppend ? `${core}\n\n${systemAppend}` : core;
}


function newInvocationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ada_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logAdaLifecycle(
  debug: AdaDebugContext | undefined,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  if (!debug?.enabled) return;
  console.warn(
    "[ada/lifecycle]",
    JSON.stringify({
      event,
      chatTurnId: debug.chatTurnId ?? null,
      phase: debug.phase ?? null,
      ...payload,
    }),
  );
}

/** Logs HTTP-layer Anthropic errors without headers (no API key material). */
function logAnthropicApiError(err: APIError): void {
  console.warn(
    "[ada/claude] Anthropic API error (safe summary):",
    JSON.stringify({
      status: err.status,
      type: err.type,
      requestID: err.requestID,
      message: err.message,
    }),
  );
}

/**
 * Ada-only Claude call (Phase 4).
 *
 * Messages use `toSharedAgentMessages` — labeled [Joshua]/[Ada]/[Leo] transcript.
 * System = §7 identity + §9 Joshua + §10 memory + labeled-thread guidance; optional
 * `systemAppend` adds deferral (§5) for secondary calls only.
 */
export async function callAda(
  messages: ClaudeTurn[],
  options?: {
    systemAppend?: string;
    memory?: AdaMemoryInjection;
    debug?: AdaDebugContext;
  },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildAdaSystemPrompt(options?.memory);
  const system = withLabeledThreadSystem(base, options?.systemAppend);
  const debug = options?.debug;
  const adaInvocationId = newInvocationId();

  logAdaLifecycle(debug, "callAda_invoked", {
    adaInvocationId,
    model,
    messageCount: messages.length,
  });

  let response: unknown;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages,
    });
  } catch (err: unknown) {
    if (err instanceof APIError) {
      logAnthropicApiError(err);
      throw new Error(
        `Anthropic Messages API failed (${err.status ?? "no_status"}${err.type ? `, ${err.type}` : ""}): ${err.message}`,
      );
    }
    throw err;
  }

  const responseSummary = summarizeClaudeResponseForLog(response);

  if (process.env.ADA_DEBUG_CLAUDE === "1") {
    console.warn(
      "[ada/claude] response shape (ADA_DEBUG_CLAUDE):",
      JSON.stringify(responseSummary),
    );
  }

  logAdaLifecycle(debug, "callAda_response_shape", {
    adaInvocationId,
    contentBlockCount: responseSummary.contentBlockCount,
    contentBlockTypes: responseSummary.contentBlockTypes,
    textSegmentCount: responseSummary.textSegmentCount,
    combinedTextLength: responseSummary.combinedTextLength,
  });

  const out = assistantTextFromClaudeMessage(response);

  logAdaLifecycle(debug, "callAda_return", {
    adaInvocationId,
    outputLength: out.length,
  });

  return out;
}

/**
 * Stream Ada’s reply token-by-token; full text is the same as a non-streaming call.
 * Primary turn in POST /api/chat; deferral (secondary) still uses {@link callAda}.
 */
export async function streamAda(
  messages: ClaudeTurn[],
  options: {
    systemAppend?: string;
    onDelta: (chunk: string) => void;
    memory?: AdaMemoryInjection;
    debug?: AdaDebugContext;
  },
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const base = buildAdaSystemPrompt(options.memory);
  const system = withLabeledThreadSystem(base, options.systemAppend);
  const debug = options.debug;
  const adaInvocationId = newInvocationId();

  logAdaLifecycle(debug, "streamAda_invoked", {
    adaInvocationId,
    model,
    messageCount: messages.length,
  });

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system,
      messages,
    });

    /**
     * `text` deltas drive streaming UX. Second arg is per-block cumulative snapshot
     * (SDK); useful recovery if delta accumulation stayed empty.
     */
    let accumulatedDeltas = "";
    let lastTextSnapshot = "";
    let sawFirstDelta = false;
    let deltaCount = 0;

    stream.on("text", (textDelta: string, textSnapshot: string) => {
      if (!sawFirstDelta) {
        sawFirstDelta = true;
        logAdaLifecycle(debug, "streamAda_text_delta_begin", {
          adaInvocationId,
          firstDeltaLength: textDelta.length,
        });
      }
      deltaCount += 1;
      accumulatedDeltas += textDelta;
      lastTextSnapshot = textSnapshot ?? "";
      options.onDelta(textDelta);
    });

    const finalMsg = await stream.finalMessage();
    const finalMsgSummary = summarizeClaudeResponseForLog(finalMsg);
    const fromMessageBlocks = extractAssistantText(finalMsg.content);

    let sdkFinalText: string | null = null;
    try {
      sdkFinalText = await stream.finalText();
    } catch {
      sdkFinalText = null;
    }

    const { text: merged, winner } = reconcileAdaStreamText({
      accumulatedDeltas,
      lastTextSnapshot,
      sdkFinalText,
      fromMessageBlocks,
    });

    if (process.env.ADA_STREAM_RECONCILE_LOG === "1" || debug?.enabled) {
      console.warn(
        "[ada/claude] stream_reconcile",
        JSON.stringify({
          chatTurnId: debug?.chatTurnId ?? null,
          phase: debug?.phase ?? null,
          adaInvocationId,
          winner,
          deltaCount,
          lenStreamedDeltas: accumulatedDeltas.length,
          lenTextSnapshot: lastTextSnapshot.length,
          lenFinalText: sdkFinalText?.length ?? 0,
          lenFromMessageBlocks: fromMessageBlocks.length,
          finalMessageContentBlockCount: finalMsgSummary.contentBlockCount,
          finalMessageContentBlockTypes: finalMsgSummary.contentBlockTypes,
        }),
      );
    }

    if (!merged.trim()) {
      console.warn(
        `[ada/claude] streamAda: empty assistant text after reconciliation (winner=${winner})`,
      );
      throw new Error("Ada returned no text");
    }

    logAdaLifecycle(debug, "streamAda_return", {
      adaInvocationId,
      winner,
      deltaCount,
      outputLength: merged.length,
      finalMessageContentBlockCount: finalMsgSummary.contentBlockCount,
      finalMessageContentBlockTypes: finalMsgSummary.contentBlockTypes,
    });

    return merged;
  } catch (err: unknown) {
    if (err instanceof APIError) {
      logAnthropicApiError(err);
      throw new Error(
        `Anthropic Messages stream failed (${err.status ?? "no_status"}${err.type ? `, ${err.type}` : ""}): ${err.message}`,
      );
    }
    throw err;
  }
}
