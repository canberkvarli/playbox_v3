import { useEffect, useRef, useState } from 'react';
import { getDriver, type ProximityState } from '@/lib/hardware';

/**
 * How long to keep showing `in_range` after the driver reports a drop out of
 * range. BLE advertisement scans routinely miss a beacon for a tick or two,
 * which without smoothing makes the station CTA flap between "oyna" and
 * "kontrol ediliyor…". A real walk-away lasts far longer than this window, so
 * a sustained drop still lands — just a few seconds late.
 */
const DOWNGRADE_GRACE_MS = 4000;

export type ProximityResult = {
  inRange: boolean;
  state: ProximityState;
  /** True if the user explicitly needs to grant something (BLE / location). */
  needsPermission: boolean;
  /** True if the OS BLE adapter is off and the user should turn it on. */
  bluetoothOff: boolean;
  /** True only on platforms without BLE (web, simulator without sim plugins). */
  unsupported: boolean;
};

/**
 * Watches BLE proximity for the given station id. Backed by the active
 * hardware driver — mock by default in dev, real BLE in production (or in
 * dev when `useDevStore.bleHardware` is true).
 *
 * Returns both the simple `inRange` boolean and a richer `state` so screens
 * can show "scanning…", "bluetooth kapalı", "izin ver", etc.
 */
export function useStationInRange(stationId: string | null) {
  const [state, setState] = useState<ProximityState>({ kind: 'idle' });
  // Mirror of the smoothed state so the watcher callback can read the current
  // value without re-subscribing. Holds the pending downgrade + its timer.
  const stateRef = useRef<ProximityState>(state);
  const downgradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNext = useRef<ProximityState | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (downgradeTimer.current) {
        clearTimeout(downgradeTimer.current);
        downgradeTimer.current = null;
      }
      pendingNext.current = null;
    };
    const apply = (next: ProximityState) => {
      stateRef.current = next;
      setState(next);
    };

    if (!stationId) {
      clearTimer();
      apply({ kind: 'idle' });
      return;
    }

    const driver = getDriver();
    const sub = driver.watchStation(stationId, (next) => {
      // Coming (back) into range always wins immediately and cancels any
      // pending downgrade — the user is close, show "oyna" right away.
      if (next.kind === 'in_range') {
        clearTimer();
        apply(next);
        return;
      }
      // Currently in range and the driver reports a drop: don't apply it yet.
      // Stash the latest target and let the grace timer commit it, so a
      // momentary scan miss doesn't flicker the CTA back to "kontrol ediliyor".
      if (stateRef.current.kind === 'in_range') {
        pendingNext.current = next;
        if (!downgradeTimer.current) {
          downgradeTimer.current = setTimeout(() => {
            downgradeTimer.current = null;
            const target = pendingNext.current;
            pendingNext.current = null;
            if (target) apply(target);
          }, DOWNGRADE_GRACE_MS);
        }
        return;
      }
      // Not in range — permission/bluetooth/scanning/out-of-range all apply
      // immediately so the user sees the true state without delay.
      clearTimer();
      apply(next);
    });
    return () => {
      clearTimer();
      sub.stop();
    };
  }, [stationId]);

  const inRange = state.kind === 'in_range';
  const needsPermission = state.kind === 'permission_denied';
  const bluetoothOff = state.kind === 'bluetooth_off';
  const unsupported = state.kind === 'unsupported';

  return { inRange, state, needsPermission, bluetoothOff, unsupported };
}
