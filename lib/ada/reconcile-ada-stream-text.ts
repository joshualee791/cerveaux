/**
 * Picks canonical assistant text after a Claude MessageStream completes.
 * Streamed deltas win whenever non-empty (matches what onDelta already sent).
 */

export type AdaStreamReconcileWinner =
  | "streamed_deltas"
  | "finalText"
  | "finalMessage_extract"
  | "text_snapshot"
  | "none";

export type AdaStreamReconcileResult = {
  text: string;
  winner: AdaStreamReconcileWinner;
};

export function reconcileAdaStreamText(params: {
  accumulatedDeltas: string;
  lastTextSnapshot: string;
  sdkFinalText: string | null;
  fromMessageBlocks: string;
}): AdaStreamReconcileResult {
  const {
    accumulatedDeltas,
    lastTextSnapshot,
    sdkFinalText,
    fromMessageBlocks,
  } = params;

  if (accumulatedDeltas.trim().length > 0) {
    return { text: accumulatedDeltas, winner: "streamed_deltas" };
  }

  if (sdkFinalText && sdkFinalText.trim().length > 0) {
    return { text: sdkFinalText, winner: "finalText" };
  }

  if (fromMessageBlocks.trim().length > 0) {
    return { text: fromMessageBlocks, winner: "finalMessage_extract" };
  }

  if (lastTextSnapshot.trim().length > 0) {
    return { text: lastTextSnapshot, winner: "text_snapshot" };
  }

  return { text: "", winner: "none" };
}
