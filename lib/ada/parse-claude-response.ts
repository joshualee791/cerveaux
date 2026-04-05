import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";

/**
 * Safe, secrets-free summary for server logs when debugging Claude response shapes.
 */
export type ClaudeResponseShapeSummary = {
  id?: string;
  model?: string;
  role?: unknown;
  stop_reason?: unknown;
  stop_sequence?: unknown;
  contentBlockCount: number | null;
  contentBlockTypes: string[];
  textSegmentCount: number;
  combinedTextLength: number;
  topLevelError?: { type?: string; messagePreview?: string };
};

function previewString(s: string, max = 200): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Extract a short message from an Anthropic error object (no headers / no API key).
 */
export function summarizeAnthropicErrorField(error: unknown): string {
  if (error === null || error === undefined) return "unknown";
  if (typeof error === "string") return previewString(error);
  if (typeof error !== "object") return String(error);
  const o = error as Record<string, unknown>;
  const nested = o.error;
  if (nested && typeof nested === "object") {
    const e = nested as Record<string, unknown>;
    const t = typeof e.type === "string" ? e.type : "";
    const m = typeof e.message === "string" ? e.message : "";
    if (t || m) return [t, m].filter(Boolean).join(": ") || previewString(JSON.stringify(nested));
  }
  const type = typeof o.type === "string" ? o.type : "";
  const message = typeof o.message === "string" ? o.message : "";
  if (type || message) return [type, message].filter(Boolean).join(": ");
  return previewString(JSON.stringify(error));
}

export function summarizeClaudeResponseForLog(response: unknown): ClaudeResponseShapeSummary {
  if (response === null || typeof response !== "object") {
    return {
      contentBlockCount: null,
      contentBlockTypes: [],
      textSegmentCount: 0,
      combinedTextLength: 0,
    };
  }

  const r = response as Record<string, unknown>;
  const rawContent = r.content;
  let contentBlockTypes: string[] = [];
  let contentBlockCount: number | null = null;
  let textSegmentCount = 0;
  let combinedTextLength = 0;

  if (Array.isArray(rawContent)) {
    contentBlockCount = rawContent.length;
    for (const b of rawContent) {
      if (b && typeof b === "object" && "type" in b) {
        const t = String((b as { type: unknown }).type);
        contentBlockTypes.push(t);
        if (t === "text" && "text" in b && typeof (b as { text?: unknown }).text === "string") {
          textSegmentCount += 1;
          combinedTextLength += (b as { text: string }).text.length;
        }
      } else {
        contentBlockTypes.push("invalid_block");
      }
    }
  } else if (rawContent === undefined) {
    contentBlockTypes = ["content_undefined"];
  } else {
    contentBlockTypes = [`content_not_array:${typeof rawContent}`];
  }

  let topLevelError: ClaudeResponseShapeSummary["topLevelError"];
  const err = r.error;
  if (err !== null && err !== undefined && typeof err === "object") {
    const eo = err as Record<string, unknown>;
    topLevelError = {
      type: typeof eo.type === "string" ? eo.type : undefined,
      messagePreview:
        typeof eo.message === "string" ? previewString(eo.message, 200) : undefined,
    };
  }

  return {
    id: typeof r.id === "string" ? r.id : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
    role: r.role,
    stop_reason: r.stop_reason,
    stop_sequence: r.stop_sequence,
    contentBlockCount,
    contentBlockTypes,
    textSegmentCount,
    combinedTextLength,
    ...(topLevelError ? { topLevelError } : {}),
  };
}

function extractTextFromBlocks(content: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n\n");
}

function nonTextBlockTypes(content: ContentBlock[]): string[] {
  const types: string[] = [];
  for (const block of content) {
    if (block.type !== "text") {
      types.push(block.type);
    }
  }
  return types;
}

/**
 * Returns concatenated assistant text from all `text` blocks; ignores thinking,
 * tool_use, and other block types. Empty string if there are no text blocks.
 */
export function extractAssistantText(content: ContentBlock[] | undefined): string {
  if (!content?.length) return "";
  return extractTextFromBlocks(content);
}

/**
 * Parse a successful Messages API JSON body into assistant text.
 * Logs shape summaries when the outcome is unusual or erroneous.
 */
export function assistantTextFromClaudeMessage(response: unknown): string {
  const summary = summarizeClaudeResponseForLog(response);

  if (response === null || typeof response !== "object") {
    console.warn(
      "[ada/claude] Unexpected response (not an object):",
      JSON.stringify(summary),
    );
    throw new Error(
      `Claude API returned a non-object response (typeof=${typeof response})`,
    );
  }

  const r = response as Record<string, unknown>;

  if ("error" in r && r.error != null) {
    console.warn(
      "[ada/claude] Response body includes error field:",
      JSON.stringify({ ...summary, errorDetail: summarizeAnthropicErrorField(r.error) }),
    );
    throw new Error(
      `Claude response error object: ${summarizeAnthropicErrorField(r.error)}`,
    );
  }

  const contentUnknown = r.content;
  if (!Array.isArray(contentUnknown)) {
    console.warn(
      "[ada/claude] Missing or invalid content array:",
      JSON.stringify(summary),
    );
    throw new Error(
      `Claude response has no content array (got ${contentUnknown === undefined ? "undefined" : typeof contentUnknown})`,
    );
  }

  const content = contentUnknown as ContentBlock[];
  const text = extractAssistantText(content);
  const nonText = nonTextBlockTypes(content);

  if (text.length > 0) {
    return text;
  }

  console.warn(
    "[ada/claude] No text blocks in response; shape:",
    JSON.stringify(summary),
  );

  if (content.length === 0) {
    return "";
  }

  const stopReason = r.stop_reason;
  if (stopReason === "tool_use" || nonText.includes("tool_use")) {
    throw new Error(
      `Claude returned no assistant text: tool_use block(s) present but tools are not configured for this client (stop_reason=${String(stopReason)}, blocks=${summary.contentBlockTypes.join(",")})`,
    );
  }

  // thinking-only, redacted_thinking-only, server_tool_use, etc. — degrade to empty string
  return "";
}
