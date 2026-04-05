/**
 * Appended to agent system prompts so models interpret [Joshua]/[Ada]/[Leo] labels correctly.
 * Kept short — routing still decides who speaks; this only frames visibility + voice boundaries.
 */
export const LABELED_THREAD_GUIDANCE = `CONVERSATION THREAD (INPUT ONLY — NOT YOUR OUTPUT FORMAT)
The messages above are a labeled transcript for context: [Joshua]:, [Ada]:, [Leo]: appear only so you can follow who said what. That structure exists in INPUT, not in what you write.

OUTPUT CONTRACT (MANDATORY)
- You MUST NOT format your reply as a labeled transcript or script.
- You MUST treat the labeled thread strictly as input context, never as an output template.
- You MUST NOT include anywhere in your response: [Ada]:, [Leo]:, [Joshua]:, or any bracketed speaker label (including mid-line or inline).
- You MUST NOT start any line with a bracketed name or colon label.
- You MUST NOT write lines of dialogue for Leo or Joshua, and you MUST NOT continue a multi-speaker exchange.
- You speak as one participant: continuous plain prose only, in your normal voice.

Do not restate the other agent’s message unless you add material value or direct evaluation the user asked for.`;
