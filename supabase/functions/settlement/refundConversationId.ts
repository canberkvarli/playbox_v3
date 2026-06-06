// Pure conversationId builders for Phase 2 settlement.
//
// iyzico keys idempotency partly off the `conversationId` we send. To make the
// settlement money operations (capture / release / refund) idempotent on the
// iyzico side, we derive a STABLE conversationId per reservation + operation.
// Re-sending the same conversationId for the same reservation lets iyzico
// recognise a retry rather than treating it as a fresh, double-charging request.
//
// These are intentionally Deno-free and dependency-free so they can be unit
// tested under Jest without importing the Deno-only iyzico client. Task 4's
// settlement orchestration imports these to build its iyzico request payloads.

/** Stable conversationId for refunding a captured deposit/penalty. */
export function refundConversationId(reservationId: string): string {
  return `settle:${reservationId}:refund`;
}

/** Stable conversationId for capturing (postauth) a deposit on settlement. */
export function captureConversationId(reservationId: string): string {
  return `settle:${reservationId}:capture`;
}

/** Stable conversationId for releasing (cancel) an uncaptured hold on settlement. */
export function releaseConversationId(reservationId: string): string {
  return `settle:${reservationId}:release`;
}
