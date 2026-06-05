// Pure decision logic for linking a BLE session_id to a reservation.
//
// This module is intentionally Deno-free and dependency-free (no `Deno.*`, no
// remote esm imports, no supabase import) so that Jest (Node) can import it
// directly for unit testing — matching the pattern proven by
// supabase/functions/_shared/canonical.ts. The Deno edge function
// (sign-unlock/index.ts) does only the thin Supabase I/O around this.
//
// Background: today the BLE `session_id` is client-ephemeral and never stored
// server-side, so an incoming `gate_closed` event (which carries only the
// session_id) can't be tied back to a reservation. When sign-unlock signs an
// `unlock`, we persist the linkage on the caller's live reservation so the
// reconciliation pipeline can later map physical events back to the hold.

/** A reservation candidate as seen by the selector. */
export type ReservationCandidate = {
  id: string;
  /** reservation_status enum value. */
  status: string;
  /** The gate identifier (reservations.gate_id, TEXT). */
  gate_id: string;
  /** Currently-linked BLE session, if any. */
  ble_session_id: string | null;
  /** Used to break ties; ISO timestamp string. Optional. */
  created_at?: string | null;
};

/**
 * Result of the selection.
 *  - `{ reservationId }`           → link this reservation to the session.
 *  - `{ skip: 'no_match' }`        → no candidate matches the gate / status.
 *  - `{ skip: 'already_linked' }`  → the chosen reservation already carries
 *                                    this exact session_id (idempotent no-op).
 *  - `{ skip: 'conflict' }`        → the chosen reservation is already linked to
 *                                    a DIFFERENT session_id; do not clobber it.
 */
export type LinkDecision =
  | { reservationId: string }
  | { skip: 'no_match' | 'already_linked' | 'conflict' };

// Only these statuses are eligible to be linked. An `unlock` is signed for a
// reservation the caller is actively fulfilling: it is `active` (reserved,
// not yet consumed) or `consumed` (QR-scanned, hold released, session live).
// cancelled / expired_* are terminal and must never be linked.
const LINKABLE_STATUSES = new Set(['active', 'consumed']);

// Preference order when multiple candidates match the same gate. `consumed`
// outranks `active` because a consumed reservation is the one whose session is
// actually live (the user already scanned in). Higher number = preferred.
const STATUS_RANK: Record<string, number> = {
  consumed: 2,
  active: 1,
};

/**
 * Selects which of the caller's candidate reservations to link to `sessionId`
 * for the target `gateId`, or returns a skip reason.
 *
 * `gateId` is the reservation SLUG (e.g. "DEV-001-football-1"), NOT a number.
 * reservations.gate_id is `${stationId}-${sport}-${n}`, so matching is done on
 * the exact slug — this avoids the multi-sport numeric ambiguity (football-1
 * vs basketball-1 both trail "1"). The caller passes the slug the client held
 * from the reserve flow; the numeric physical gate is only used for signing.
 *
 * Rules (pure, total — no I/O, no throws for normal input):
 *  1. Filter to candidates whose status is linkable (active/consumed) AND
 *     whose gate_id === gateId (exact slug match).
 *  2. If none remain → `{ skip: 'no_match' }`.
 *  3. Otherwise pick the best: prefer `consumed` over `active`; within the same
 *     status, prefer the most-recent by `created_at` (later wins; missing
 *     created_at sorts oldest). Original array order breaks remaining ties.
 *  4. If the chosen reservation's ble_session_id already equals `sessionId` →
 *     `{ skip: 'already_linked' }` (idempotent no-op).
 *  5. If it is linked to a different non-null session_id → `{ skip: 'conflict' }`
 *     (never clobber an existing distinct linkage).
 *  6. Else → `{ reservationId: chosen.id }`.
 */
export function selectReservationToLink(
  reservations: ReservationCandidate[],
  gateId: string,
  sessionId: string,
): LinkDecision {
  const candidates = (reservations ?? []).filter(
    (r) => r != null && LINKABLE_STATUSES.has(r.status) && r.gate_id === gateId,
  );

  if (candidates.length === 0) {
    return { skip: 'no_match' };
  }

  // Pick the best candidate. We do a stable reduce so original array order is
  // the final tie-breaker (no Array.sort instability concerns).
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (isPreferred(candidates[i], best)) best = candidates[i];
  }

  if (best.ble_session_id === sessionId) {
    return { skip: 'already_linked' };
  }
  if (best.ble_session_id != null && best.ble_session_id !== sessionId) {
    return { skip: 'conflict' };
  }
  return { reservationId: best.id };
}

/** True if `a` should be preferred over the current best `b`. */
function isPreferred(a: ReservationCandidate, b: ReservationCandidate): boolean {
  const ra = STATUS_RANK[a.status] ?? 0;
  const rb = STATUS_RANK[b.status] ?? 0;
  if (ra !== rb) return ra > rb;
  // Same status → most-recent wins. Missing timestamps sort as oldest (0).
  const ta = a.created_at ? Date.parse(a.created_at) : 0;
  const tb = b.created_at ? Date.parse(b.created_at) : 0;
  const na = Number.isNaN(ta) ? 0 : ta;
  const nb = Number.isNaN(tb) ? 0 : tb;
  return na > nb;
}
