/**
 * Cold-launch recovery decision (pure, RN-import-free so Jest can import it
 * directly).
 *
 * Problem this solves: the active session persists across an app kill/restart
 * (Zustand persist -> AsyncStorage), but on a fresh launch the app does NOT
 * re-establish the BLE EVENTS subscription / passive watch for that station.
 * So an incoming `gate_closed` after a `return_unlock` would be missed and the
 * return could never auto-confirm. `shouldReattach` is the decision the boot
 * code consults: given the persisted session, should we re-subscribe?
 *
 * This module makes NO side effects and performs NO writes — it only decides.
 * Re-subscription itself lives in the RN boot path.
 */

/**
 * Maximum age (from `startedAt`) for which we'll re-subscribe on cold launch.
 *
 * Rationale for 6h: Playbox rentals are short, self-serve gear sessions (the
 * planned `durationMinutes` is on the order of tens of minutes, and overtime
 * is billed). A session that started more than six hours ago is effectively
 * dead from the renter's perspective — the firmware's own return/overdue
 * timeouts will have long since fired, and there is no value in spinning the
 * BLE radio to await a `gate_closed` that, realistically, already happened
 * (and was handled server-side) or never will. Six hours is comfortably longer
 * than any legitimate rental + reasonable overtime, while still bounding stale
 * radio work after a phone that was off overnight. Callers may override via
 * `opts.maxAgeMs` (e.g. tests, or a future longer rental tier).
 */
export const COLD_LAUNCH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * The persisted active-session shape, narrowed to only what the cold-launch
 * decision reads. Kept structural (not an import of the store's type) so this
 * file stays free of any RN / zustand dependency and remains trivially
 * unit-testable.
 */
export type ReattachSession = {
  stationId?: string | null;
  stationName?: string | null;
  bleSessionId?: string | null;
  gate?: number | null;
  startedAt?: number | null;
  returnConfirmed?: boolean | null;
  /**
   * Set (to Date.now()) when the phone successfully writes `return_unlock` and
   * begins awaiting `gate_closed`. ONLY a session in this state has an inbound
   * BLE event worth re-subscribing for on cold launch. A plain active rental
   * does not — reattaching one would scan the radio indefinitely and starve
   * the single iOS scan, wedging proximity for every station.
   */
  returnInitiatedAt?: number | null;
} | null | undefined;

export type ReattachDecision =
  | {
      reattach: true;
      stationId: string;
      stationName: string;
      bleSessionId: string;
      gate: number;
    }
  | {
      reattach: false;
      reason:
        | 'no_session'
        | 'already_returned'
        | 'expired'
        | 'incomplete'
        | 'not_returning';
    };

export type ReattachOptions = {
  /** Override the staleness window. Defaults to {@link COLD_LAUNCH_MAX_AGE_MS}. */
  maxAgeMs?: number;
};

/**
 * Decide whether the persisted session should have its passive watch + EVENTS
 * subscription re-established on cold launch.
 *
 * Pure and total: never throws, always returns a decision.
 *
 * Order of checks is deliberate:
 *   1. no_session        — nothing persisted.
 *   2. already_returned  — terminal: the return was firmware-confirmed. We
 *      check this before age so a confirmed-but-ancient session reports its
 *      true terminal reason rather than `expired`.
 *   3. incomplete        — missing a field needed to resume (stationId,
 *      stationName, bleSessionId, gate, or a usable startedAt). Without these
 *      we cannot address the gate or correlate a `gate_closed`.
 *   4. not_returning     — no return is in progress (no `returnInitiatedAt`),
 *      so there is no inbound `gate_closed` to catch. Reattaching here would
 *      just spin the BLE radio forever (and starve the single iOS scan), which
 *      is the cause of the "BLE wedged until reinstall" bug. Skip.
 *   5. expired           — older than maxAge; stale, skip.
 *   6. reattach: true.
 */
export function shouldReattach(
  session: ReattachSession,
  nowMs: number,
  opts?: ReattachOptions,
): ReattachDecision {
  if (!session) return { reattach: false, reason: 'no_session' };

  if (session.returnConfirmed === true) {
    return { reattach: false, reason: 'already_returned' };
  }

  const { stationId, stationName, bleSessionId, gate, startedAt, returnInitiatedAt } = session;

  if (
    !stationId ||
    !stationName ||
    !bleSessionId ||
    typeof gate !== 'number' ||
    !Number.isFinite(gate) ||
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt)
  ) {
    return { reattach: false, reason: 'incomplete' };
  }

  // No return in progress → no `gate_closed` is coming, so there's nothing to
  // re-subscribe for. Crucially, this is what stops a plain active rental from
  // spinning the BLE radio on every cold launch.
  if (typeof returnInitiatedAt !== 'number' || !Number.isFinite(returnInitiatedAt)) {
    return { reattach: false, reason: 'not_returning' };
  }

  const maxAgeMs = opts?.maxAgeMs ?? COLD_LAUNCH_MAX_AGE_MS;
  const ageMs = nowMs - startedAt;
  if (ageMs > maxAgeMs) {
    return { reattach: false, reason: 'expired' };
  }

  return { reattach: true, stationId, stationName, bleSessionId, gate };
}
