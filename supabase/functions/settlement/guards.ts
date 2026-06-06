// PURE settlement guards — Deno-free, no imports, total functions.
//
// Two abuse/quarantine predicates for the Phase 2 settlement worker (Phase 4,
// Task 2). Kept in their own module so Jest can import + prove them with no Deno
// runtime, matching ./decide.ts and ./refundConversationId.ts.

/**
 * True when a reservation must be SKIPPED by auto-settlement because it is
 * either under operator dispute (`disputed_at` set) OR quarantined after too
 * many failed settlement attempts (`quarantined_at` set). Money for a blocked
 * row is frozen until an operator clears the flag (Phase 4 Task 4).
 *
 * Total: ""/null timestamps are treated as NOT-set (a stray empty string from a
 * loose query must never accidentally pause settlement). A non-empty string in
 * EITHER column blocks the row.
 */
export function isSettlementBlocked(c: {
  disputed_at: string | null;
  quarantined_at: string | null;
}): boolean {
  const isSet = (v: string | null): boolean => typeof v === "string" && v.length > 0;
  return isSet(c.disputed_at) || isSet(c.quarantined_at);
}

/**
 * True when a deposit has failed settlement enough times to be parked. A
 * permanently-failing deposit (e.g. a deleted iyzico payment ref) would
 * otherwise be retried by the worker forever; once `settleAttempts` reaches
 * `maxAttempts` the caller quarantines it so retries stop.
 *
 * Total: a pure `>=` comparison. The caller supplies the effective maxAttempts
 * (its own default handling), so this function applies no default of its own.
 */
export function shouldQuarantine(settleAttempts: number, maxAttempts: number): boolean {
  return settleAttempts >= maxAttempts;
}
