import type { HardwareDriver, ProximityState, UnlockResult } from './types';

/**
 * Mock driver — the only one safe to use in dev / simulator. Pretends every
 * station is in range after a short scan and accepts all unlock requests.
 *
 * Dial these knobs to exercise edge cases:
 *   - SIMULATE_OUT_OF_RANGE: bool, force "user is too far" path
 *   - SIMULATE_UNLOCK_FAIL:  enum, force a specific UnlockError code
 *   - PROXIMITY_DELAY_MS:    number, how long the "scanning" state lingers
 */
const SIMULATE_OUT_OF_RANGE = false;
const SIMULATE_UNLOCK_FAIL: UnlockResult['ok'] extends true ? never : import('./types').UnlockError | null = null;
const PROXIMITY_DELAY_MS = 500;
const UNLOCK_DELAY_MS = 700;

export function createMockDriver(): HardwareDriver {
  return {
    watchStation(_stationId, onChange) {
      let cancelled = false;
      onChange({ kind: 'scanning' });
      const id = setTimeout(() => {
        if (cancelled) return;
        if (SIMULATE_OUT_OF_RANGE) {
          onChange({ kind: 'out_of_range' });
        } else {
          onChange({
            kind: 'in_range',
            rssi: -55,
            lastSeenAt: Date.now(),
          });
        }
      }, PROXIMITY_DELAY_MS);
      return {
        stop: () => {
          cancelled = true;
          clearTimeout(id);
        },
      };
    },

    async unlockGate({ stationId, gateId, correlationId }): Promise<UnlockResult> {
      await new Promise((r) => setTimeout(r, UNLOCK_DELAY_MS));
      if (SIMULATE_UNLOCK_FAIL) {
        return { ok: false, error: SIMULATE_UNLOCK_FAIL };
      }
      if (__DEV__) {
        console.log('[hardware/mock] unlock', { stationId, gateId, correlationId });
      }
      return { ok: true, openedAt: Date.now() };
    },

    reset() {
      // Mock has no persistent state.
    },
  };
}

export const _mockDevDefaults = {
  SIMULATE_OUT_OF_RANGE,
  SIMULATE_UNLOCK_FAIL,
  PROXIMITY_DELAY_MS,
  UNLOCK_DELAY_MS,
};

export type ProximityStateForTests = ProximityState; // re-export for tests
