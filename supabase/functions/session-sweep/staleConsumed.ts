// PURE stale-consumed decision logic — Deno-free, Supabase-free.
//
// This module holds the ONE pure predicate the session-sweep needs to close the
// STRANDED-HOLD edge: a reservation that was CONSUMED (QR scanned -> hold
// "consumed" at unlock) but whose gate was NEVER physically opened (no
// gate_opened, so opened_at is null). The user took no equipment.
//
// Such a row is caught by NEITHER:
//   - gate_closed   (there was no return, because nothing was opened), NOR
//   - the abandoned pass (shouldFlagAbandoned REQUIRES opened_at != null).
// So its live deposit hold would dangle forever. The user took nothing, so the
// correct action is RELEASE (no penalty). The Deno shell that consumes this
// predicate sets `release_eligible_at`; Phase 2 settlement then releases the hold.
//
// It imports nothing from Deno or supabase-js (no remote esm.sh imports), so Jest
// can import it directly — same proven pattern as `abandoned.ts`,
// `ingest-events/reconcile.ts`, and `_shared/canonical.ts`.
//
// MONEY SEAM: this predicate NEVER moves money. RELEASE only — never capture.

// The minimal reservation shape this predicate reads. Structurally typed so this
// module needs no import from supabase-js.
//   - terminal_at: set when the row left `active` (i.e. at consume time); used
//     as the consume timestamp for the timeout.
export type StaleConsumedCandidate = {
  status: string;
  opened_at: string | null;
  returned_at: string | null;
  terminal_at: string | null;
  release_eligible_at: string | null;
  penalty_eligible_at: string | null;
  reversal_eligible_at: string | null;
};

// TRUE iff this reservation is a consumed-but-never-opened row whose live hold
// has dangled past the consume->open timeout and should be RELEASED.
//
// Rules (all must hold):
//   - status === 'consumed'        (QR scanned, hold consumed at unlock)
//   - opened_at == null            (gate never physically opened => no equipment
//                                   taken; an opened row is the abandoned path)
//   - returned_at == null          (set => the ball came back; not stranded)
//   - release_eligible_at == null  AND
//     penalty_eligible_at == null  AND
//     reversal_eligible_at == null (already flagged => idempotent no-op)
//   - terminal_at != null          (the consume timestamp must exist)
//   - (nowMs - Date.parse(terminal_at)) > maxConsumeToOpenMs
//
// PURE + TOTAL: an unparseable terminal_at yields NaN from Date.parse; the
// comparison `NaN > maxConsumeToOpenMs` is false, so a garbage timestamp safely
// => false (we never release on data we can't reason about).
export function shouldReleaseStaleConsumed(
  reservation: StaleConsumedCandidate,
  nowMs: number,
  maxConsumeToOpenMs: number,
): boolean {
  if (reservation.status !== "consumed") return false;
  if (reservation.opened_at != null) return false;
  if (reservation.returned_at != null) return false;
  if (reservation.release_eligible_at != null) return false;
  if (reservation.penalty_eligible_at != null) return false;
  if (reservation.reversal_eligible_at != null) return false;
  if (reservation.terminal_at == null) return false;

  const consumedMs = Date.parse(reservation.terminal_at);
  if (Number.isNaN(consumedMs)) return false;

  return nowMs - consumedMs > maxConsumeToOpenMs;
}
