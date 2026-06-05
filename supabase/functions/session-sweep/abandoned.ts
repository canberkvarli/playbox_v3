// PURE abandoned-session decision logic — Deno-free, Supabase-free.
//
// This module holds the ONE pure predicate the session-sweep needs to decide
// whether a reservation that was physically opened but never returned has now
// exceeded the max in-use window and should be flagged penalty-eligible. It
// imports nothing from Deno or supabase-js (no remote esm.sh imports), so Jest
// can import it directly — same proven pattern as `ingest-events/reconcile.ts`
// and `_shared/canonical.ts`.
//
// MONEY SEAM: this predicate NEVER moves money. The Deno shell that consumes it
// only sets `penalty_eligible_at` + writes an audit row. Phase 2 reads that flag
// and actually captures the hold. See the `// PHASE 2:` marker in index.ts.
//
// COMPLEMENTS (does NOT replace) the existing reservation-sweep, which captures
// reservations that EXPIRE before being consumed. THIS case is the opposite:
// opened-but-never-returned.

// The minimal reservation shape this predicate reads. Structurally typed so this
// module needs no import from reconcile.ts; mirrors the reconciliation columns
// added in migration 20260605120000 plus the always-present `status`.
export type AbandonedCandidate = {
  status: string;
  opened_at: string | null;
  returned_at: string | null;
  penalty_eligible_at: string | null;
};

// Statuses for which an opened-but-not-returned session can be abandoned. A
// reservation that physically opened a gate is `active` (still in use) or
// `consumed` (the hold was settled at unlock but the ball can still be returned).
// `cancelled` / `expired_*` are terminal voids — never abandon those.
const ABANDONABLE_STATUSES = new Set(["active", "consumed"]);

// TRUE iff this reservation was physically opened, never returned, is not
// already flagged, and the time since opening exceeds maxInUseMs.
//
// Rules (all must hold):
//   - status in (active, consumed)
//   - opened_at != null      (null => never physically opened: that's the
//                             existing expiry sweep's job, NOT abandonment)
//   - returned_at == null    (set => the ball came back, not abandoned)
//   - penalty_eligible_at == null  (already flagged => idempotent no-op)
//   - (nowMs - Date.parse(opened_at)) > maxInUseMs
//
// PURE + TOTAL: an unparseable opened_at yields NaN from Date.parse; the
// comparison `NaN > maxInUseMs` is false, so a garbage timestamp safely => false
// (we never flag on data we can't reason about).
export function shouldFlagAbandoned(
  reservation: AbandonedCandidate,
  nowMs: number,
  maxInUseMs: number,
): boolean {
  if (!ABANDONABLE_STATUSES.has(reservation.status)) return false;
  if (reservation.opened_at == null) return false;
  if (reservation.returned_at != null) return false;
  if (reservation.penalty_eligible_at != null) return false;

  const openedMs = Date.parse(reservation.opened_at);
  if (Number.isNaN(openedMs)) return false;

  return nowMs - openedMs > maxInUseMs;
}
