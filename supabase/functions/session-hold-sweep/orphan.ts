// PURE orphan-hold decision logic — Deno-free, Supabase-free. Jest-importable
// (same proven pattern as session-sweep/abandoned.ts and _shared/canonical.ts).
//
// MONEY SEAM: unlike abandoned.ts, the session-hold-sweep that consumes this
// predicate DOES move money — but ONLY ever to RELEASE (iyzico cancel) a hold,
// never to capture. Releasing a hold we can't tie to a measured session is the
// safe default: the user is not charged for a session we can't account for, and
// their card is freed. (Correct billing for an app-died-mid-completed-session is
// the job of the larger server-authoritative session work, not this safety net.)

export type OrphanHoldCandidate = {
  state: string;
  created_at: string | null;
};

// TRUE iff this hold is still 'held' and older than ttlMs — i.e. the client
// never captured or released it within the window, so it's orphaned and must be
// released.
//
// PURE + TOTAL: an unparseable created_at yields NaN from Date.parse; the
// comparison `NaN > ttlMs` is false, so a garbage timestamp safely => false
// (we never act on data we can't reason about).
export function shouldReleaseOrphanHold(
  hold: OrphanHoldCandidate,
  nowMs: number,
  ttlMs: number,
): boolean {
  if (hold.state !== 'held') return false;
  if (hold.created_at == null) return false;
  const createdMs = Date.parse(hold.created_at);
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs > ttlMs;
}
