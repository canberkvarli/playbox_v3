import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!stationId) {
      setState({ kind: 'idle' });
      return;
    }
    const driver = getDriver();
    const sub = driver.watchStation(stationId, setState);
    return () => sub.stop();
  }, [stationId]);

  const inRange = state.kind === 'in_range';
  const needsPermission = state.kind === 'permission_denied';
  const bluetoothOff = state.kind === 'bluetooth_off';
  const unsupported = state.kind === 'unsupported';

  return { inRange, state, needsPermission, bluetoothOff, unsupported };
}
