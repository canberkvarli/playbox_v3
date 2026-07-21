import { useCallback, useEffect, useRef, useState } from 'react';
import { getDriver, type ProximityState } from '@/lib/hardware';

export type ProximityResult = {
  inRange: boolean;
  state: ProximityState;
  /** True if the user explicitly needs to grant something (BLE / location). */
  needsPermission: boolean;
  /** True if the OS BLE adapter is off and the user should turn it on. */
  bluetoothOff: boolean;
  /** True only on platforms without BLE (web, simulator without sim plugins). */
  unsupported: boolean;
  /**
   * Terminal verdict: we tried for {@link UNREACHABLE_MS} and never once
   * connected, so we've STOPPED scanning. The station is treated as out of
   * order / no connection. UI should show a clear dead-end (not keep toggling
   * "kontrol ediliyor" forever) and offer {@link retry}.
   */
  unreachable: boolean;
  /** Re-arm the watch after an `unreachable` verdict (user tapped "tekrar dene"). */
  retry: () => void;
};

/**
 * How long to keep showing `in_range` after the driver reports a drop out of
 * range. BLE advertisement scans routinely miss a beacon for a tick or two,
 * which without smoothing makes the station CTA flap between "oyna" and
 * "kontrol ediliyor…". A real walk-away lasts far longer than this window, so
 * a sustained drop still lands — just a few seconds late.
 */
const DOWNGRADE_GRACE_MS = 4000;

/**
 * If we never reach `in_range` within this window, give up: mark the station
 * `unreachable` and STOP the watch. This kills the endless scanning ⇄
 * out_of_range churn (the "kontrol ediliyor ⇄ oyna" toggling) that happens when
 * the ESP32 is absent / stuck / out of order, and frees the radio. The user
 * gets a clear "bağlantı yok" dead-end + a manual retry instead of a CTA that
 * flickers for minutes. Reaching `in_range` even once cancels this.
 */
const UNREACHABLE_MS = 60_000;

/**
 * Watches BLE proximity for the given station id. Backed by the active
 * hardware driver — mock by default in dev, real BLE in production (or in
 * dev when `useDevStore.bleHardware` is true).
 */
export function useStationInRange(
  stationId: string | null,
  opts?: {
    /**
     * Eagerly open the GATT link rather than resting on a passive sighting, so
     * the connection is warm before an unlock. The unlock/prep screen sets this;
     * the map leaves it off. See {@link HardwareDriver.watchStation}.
     */
    eager?: boolean;
  },
): ProximityResult {
  const eager = opts?.eager === true;
  const [state, setState] = useState<ProximityState>({ kind: 'idle' });
  const [unreachable, setUnreachable] = useState(false);
  // Bumping this re-runs the effect, re-arming the watch after a give-up.
  const [retryNonce, setRetryNonce] = useState(0);
  // Mirror of the smoothed state so the watcher callback can read the current
  // value without re-subscribing. Holds the pending downgrade + its timer.
  const stateRef = useRef<ProximityState>(state);
  const downgradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNext = useRef<ProximityState | null>(null);

  const retry = useCallback(() => {
    setUnreachable(false);
    setRetryNonce((n) => n + 1);
  }, []);

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

    // Fresh subscription → not unreachable (yet).
    setUnreachable(false);
    let everInRange = false;
    let giveUpTimer: ReturnType<typeof setTimeout> | null = null;

    const driver = getDriver();
    const sub = driver.watchStation(stationId, (next) => {
      // Coming (back) into range always wins immediately and cancels any
      // pending downgrade — the user is close, show "oyna" right away.
      if (next.kind === 'in_range') {
        everInRange = true;
        if (giveUpTimer) {
          clearTimeout(giveUpTimer);
          giveUpTimer = null;
        }
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
    }, { eager });

    // Give-up timer: never connected in the window → terminal + stop scanning.
    giveUpTimer = setTimeout(() => {
      giveUpTimer = null;
      if (!everInRange) {
        setUnreachable(true);
        clearTimer();
        try {
          sub.stop();
        } catch {
          /* already stopped — ignore */
        }
      }
    }, UNREACHABLE_MS);

    return () => {
      if (giveUpTimer) clearTimeout(giveUpTimer);
      clearTimer();
      sub.stop();
    };
  }, [stationId, retryNonce, eager]);

  const inRange = state.kind === 'in_range';
  const needsPermission = state.kind === 'permission_denied';
  const bluetoothOff = state.kind === 'bluetooth_off';
  const unsupported = state.kind === 'unsupported';

  return {
    inRange,
    state,
    needsPermission,
    bluetoothOff,
    unsupported,
    unreachable,
    retry,
  };
}
