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
import { create } from 'zustand';

import type { NearbyStation } from '@/lib/hardware/types';

const STALE_MS = 15_000;

type NearbyStore = {
  seen: Record<string, NearbyStation>;
  record: (s: NearbyStation) => void;
  clear: () => void;
};

export const useNearbyStore = create<NearbyStore>((set) => ({
  seen: {},
  record: (s) =>
    set((state) => ({
      seen: { ...state.seen, [s.stationId.toUpperCase()]: s },
    })),
  clear: () => set({ seen: {} }),
}));

/** Hook: is this station currently nearby (sighting within STALE_MS)? */
export function useIsNearby(stationId: string): boolean {
  const key = stationId.toUpperCase();
  return useNearbyStore((s) => {
    const entry = s.seen[key];
    if (!entry) return false;
    return Date.now() - entry.lastSeenAt < STALE_MS;
  });
}

export const _NEARBY_STALE_MS = STALE_MS;
