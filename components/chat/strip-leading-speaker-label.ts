/**
 * Render-layer cleanup for intermittent model leakage: leading "[Ada]:", "[Leo]:",
 * or a standalone Ada/Leo label line. Skips messages that begin with a fenced
 * code block so labels inside fences are never touched.
 */
const MAX_PASSES = 4;

/** Starts (after optional leading whitespace) with a markdown code fence. */
function startsWithCodeFence(content: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(content);
}

/** Bracket speaker line: [Ada]: [Leo]: [Joshua]: */
const BRACKET_SPEAKER = /^\s*\[(Ada|Leo|Joshua)\]:\s*/i;

/**
 * Standalone first line is only Ada or Leo (label line), followed by body.
 * Requires a newline so we do not strip prose that starts with "Ada " on one line.
 */
const STANDALONE_LABEL_LINE = /^\s*(Ada|Leo)\s*\r?\n\s*/i;

export function stripLeadingSpeakerLabel(content: string): string {
  if (startsWithCodeFence(content)) {
    return content;
  }

  let s = content;
  let prev = "";
  let i = 0;
  while (s !== prev && i < MAX_PASSES) {
    prev = s;
    i += 1;
    s = s.replace(BRACKET_SPEAKER, "");
    s = s.replace(STANDALONE_LABEL_LINE, "");
  }

  return s;
}
