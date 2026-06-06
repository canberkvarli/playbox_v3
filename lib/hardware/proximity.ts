/**
 * Pure proximity predicate — "is the phone FRESHLY next to this station?"
 *
 * This module is intentionally **zero-RN-import** so Jest can import it as
 * plain logic. Keep it pure & total: same input → same output, never throws.
 *
 * WHY this exists — UX HONESTY, NOT SECURITY:
 *   A live GATT connection during unlock is the *real* presence proof — you
 *   physically cannot open a station's gate over BLE if the radio can't reach
 *   it. So this predicate is only a hint for the UI: don't dangle an "unlock"
 *   CTA in front of someone for a station the phone saw two minutes ago and
 *   hasn't heard from since. The actual `scanAndConnect` remains the source of
 *   truth; never hard-block a genuine attempt on a passive-sighting miss.
 *
 * Defaults:
 *   maxAgeMs = 10_000  — tighter than nearbyStore's 15s staleness expiry, so a
 *                        gated CTA reflects *very* recent presence and decays
 *                        a few seconds before the store row itself drops out.
 *   minRssi  = undefined (no floor) — RSSI is noisy and antenna/orientation
 *                        dependent; an RSSI floor is OPT-IN only. Callers that
 *                        want to suppress far-but-detectable advertisements can
 *                        pass e.g. { minRssi: -85 }.
 */

export type Sighting = {
  rssi: number;
  lastSeenAt: number;
};

export type ProximityOpts = {
  /** Max sighting age (ms) to still count as "fresh". Default 10_000. */
  maxAgeMs?: number;
  /**
   * Optional RSSI floor (dBm). When provided, a fresh-but-weaker-than-floor
   * sighting is NOT considered present. Omit (default) to ignore RSSI.
   */
  minRssi?: number;
};

const DEFAULT_MAX_AGE_MS = 10_000;

/**
 * True iff `sighting` is recent enough (and, if `minRssi` given, strong enough)
 * to treat the station as freshly nearby.
 *
 * Rules:
 *   - no sighting (null/undefined) → false
 *   - age = nowMs - lastSeenAt; fresh iff age <= maxAgeMs (boundary inclusive)
 *   - a negative age (future/clock-skewed lastSeenAt) is treated as fresh, not
 *     stale — we never want skew to wrongly hide a present station.
 *   - if minRssi provided: also require rssi >= minRssi
 */
export function isFreshlyPresent(
  sighting: Sighting | null | undefined,
  nowMs: number,
  opts?: ProximityOpts,
): boolean {
  return presenceReason(sighting, nowMs, opts) === 'present';
}

/**
 * Finer-grained classification for UX copy. Mirrors `isFreshlyPresent` but
 * tells you *why* the station isn't present so the CTA can show the right
 * nudge ("yaklaş" vs "sinyal zayıf").
 *
 *   'present' — fresh and (if floored) strong enough
 *   'absent'  — never seen / no sighting
 *   'stale'   — seen, but older than maxAgeMs
 *   'weak'    — fresh, but below the provided minRssi floor
 *
 * 'stale' takes priority over 'weak' (an old reading's RSSI is meaningless).
 */
export function presenceReason(
  sighting: Sighting | null | undefined,
  nowMs: number,
  opts?: ProximityOpts,
): 'present' | 'stale' | 'absent' | 'weak' {
  if (!sighting) return 'absent';

  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const age = nowMs - sighting.lastSeenAt;

  // Negative age (clock skew / future timestamp) counts as fresh, never stale.
  if (age > maxAgeMs) return 'stale';

  if (opts?.minRssi != null && sighting.rssi < opts.minRssi) return 'weak';

  return 'present';
}
