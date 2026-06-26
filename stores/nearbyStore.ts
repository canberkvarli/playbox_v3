/**
 * Last-known list of Playbox-* BLE devices the radio has seen in the current
 * foreground session. Populated by the map screen when it starts the passive
 * scan and consumed by UI bits that want a "nearby" cue (markers, cards).
 *
 * Keys are upper-cased so the lookup is case-insensitive — the driver emits
 * the upper-cased advertising-name suffix, but seed stationIds are mixed-case
 * (e.g. `DEV-001`, `ist-taksim`).
 *
 * Entries auto-expire after STALE_MS without a fresh sighting; the store
 * doesn't tick a timer itself — selectors apply the cutoff at read time, so
 * stale rows just stop matching without us paying a re-render cost on tick.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import type { NearbyStation } from '@/lib/hardware/types';
import {
  isFreshlyPresent,
  presenceReason,
  type ProximityOpts,
} from '@/lib/hardware/proximity';

// Presence stays "açık" this long after the last advertisement / connected
// sighting. Kept generous (vs the old 15s) so the brief gaps that happen during
// connect↔disconnect churn don't flicker a present station to "kapalı".
// useConnectionPresence records a sighting every 3s while connected, so a live
// connection keeps a station well inside this window even though it stops
// advertising. The real unlock still does a live scanAndConnect, so a slightly
// stale "açık" never lets someone act on a truly-gone station.
const STALE_MS = 25_000;

type NearbyStore = {
  seen: Record<string, NearbyStation>;
  // The station we currently hold a LIVE GATT connection to (UPPER-CASED), or
  // null. A connected peripheral stops advertising, so advert-based presence
  // can't see it — but a held link is the strongest possible proof of "açık".
  // Selectors OR this in so the map never shows kapalı for a station we're
  // literally connected to (the map↔detail contradiction).
  connectedId: string | null;
  record: (s: NearbyStation) => void;
  setConnected: (id: string | null) => void;
  clear: () => void;
};

export const useNearbyStore = create<NearbyStore>((set) => ({
  seen: {},
  connectedId: null,
  record: (s) =>
    set((state) => ({
      seen: { ...state.seen, [s.stationId.toUpperCase()]: s },
    })),
  setConnected: (id) => set({ connectedId: id ? id.toUpperCase() : null }),
  clear: () => set({ seen: {}, connectedId: null }),
}));

/** Hook: is this station currently nearby (sighting within STALE_MS)? */
export function useIsNearby(stationId: string): boolean {
  const key = stationId.toUpperCase();
  return useNearbyStore((s) => {
    if (s.connectedId === key) return true; // live link = authoritatively açık
    const entry = s.seen[key];
    if (!entry) return false;
    return Date.now() - entry.lastSeenAt < STALE_MS;
  });
}

/**
 * Hook: is this station FRESHLY present right now — i.e. seen within a tight
 * recency window (default 10s, see proximity.ts) — for gating the unlock CTA?
 *
 * Differs from `useIsNearby` in two ways:
 *   1. It uses the tighter `isFreshlyPresent` window (10s) rather than the
 *      store's 15s map-marker staleness, so the unlock affordance reflects
 *      *very* recent presence.
 *   2. It DECAYS ON ITS OWN. A zustand selector only re-renders when the store
 *      changes, but freshness must lapse even when no new sighting arrives (the
 *      station stopped being seen). So we drive a light 1s tick that forces a
 *      re-evaluation against a live `Date.now()`. The tick only runs while the
 *      latest sighting is still within the window — once it ages out there's
 *      nothing left to decay, so we stop ticking until the next sighting.
 *
 * UX HONESTY ONLY: a `false` here means "don't advertise this as nearby", NOT
 * "block the unlock". The real `scanAndConnect` during unlock is the source of
 * truth for presence; callers should still allow a genuine attempt.
 */
export function useIsFreshlyPresent(
  stationId: string,
  opts?: ProximityOpts,
): boolean {
  return useFreshPresence(stationId, opts).present;
}

/**
 * Same decaying evaluation as `useIsFreshlyPresent`, but also surfaces the
 * `reason` ('present' | 'stale' | 'absent' | 'weak') for CTA copy.
 */
export function useFreshPresence(
  stationId: string,
  opts?: ProximityOpts,
): { present: boolean; reason: 'present' | 'stale' | 'absent' | 'weak' } {
  const key = stationId.toUpperCase();
  const sighting = useNearbyStore((s) => s.seen[key]);
  const connected = useNearbyStore((s) => s.connectedId === key);

  // 1s tick to let freshness lapse without a new store write.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sighting) return; // nothing to decay
    const id = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [sighting]);

  // A held GATT link is authoritative — no advert needed, no decay.
  if (connected) return { present: true, reason: 'present' };

  const now = Date.now();
  return {
    present: isFreshlyPresent(sighting, now, opts),
    reason: presenceReason(sighting, now, opts),
  };
}

/**
 * Hook: the set of station IDs (UPPER-CASED) currently nearby — i.e. with a
 * sighting within `staleMs`. For list/drawer UIs that need live open/closed
 * across many stations at once without calling a hook per row.
 *
 * Self-decays via a 1s tick, but ONLY while at least one sighting exists — an
 * empty store (nothing ever seen) never ticks, so we pay no idle re-render
 * cost. Returns a fresh Set each evaluation; callers read it inline.
 */
export function useNearbyIds(staleMs: number = STALE_MS): Set<string> {
  const seen = useNearbyStore((s) => s.seen);
  const connectedId = useNearbyStore((s) => s.connectedId);
  const hasAny = Object.keys(seen).length > 0;

  const [, tick] = useState(0);
  useEffect(() => {
    if (!hasAny) return;
    const id = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [hasAny]);

  const now = Date.now();
  const out = new Set<string>();
  for (const key in seen) {
    const entry = seen[key];
    if (entry && now - entry.lastSeenAt < staleMs) out.add(key); // key already upper-cased
  }
  if (connectedId) out.add(connectedId); // live link = always present
  return out;
}

export const _NEARBY_STALE_MS = STALE_MS;
