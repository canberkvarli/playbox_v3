/**
 * Hardware driver resolver. Picks the right implementation based on env.
 *
 * Switches:
 *   - EXPO_PUBLIC_HARDWARE_DRIVER = "ble" | "mock" | "auto" (default)
 *
 *   "auto" → "mock" in __DEV__ unless the override flag is on; "ble" in
 *   release builds. The override flag (`useDevStore.bleHardware`) lets you
 *   smoke-test the real driver from a dev build by flipping a switch in
 *   settings without rebuilding.
 *
 * Always import the driver via `getDriver()` — never instantiate the BLE
 * or Mock classes directly. That keeps the swap surface to one file.
 */

import type { HardwareDriver } from './types';
import { createMockDriver } from './mock';
import { createBleDriver } from './ble';
import { useDevStore } from '@/stores/devStore';

const FORCED = process.env.EXPO_PUBLIC_HARDWARE_DRIVER;

let cached: HardwareDriver | null = null;
let cachedKind: 'mock' | 'ble' | null = null;

function pickKind(): 'mock' | 'ble' {
  if (FORCED === 'ble') return 'ble';
  if (FORCED === 'mock') return 'mock';

  if (__DEV__) {
    // Dev: mock by default; let the user opt in to real BLE via dev store.
    const live = useDevStore.getState().bleHardware;
    return live ? 'ble' : 'mock';
  }
  return 'ble';
}

export function getDriver(): HardwareDriver {
  const kind = pickKind();
  if (cached && cachedKind === kind) return cached;
  cached = kind === 'ble' ? createBleDriver() : createMockDriver();
  cachedKind = kind;
  return cached;
}

/** For tests + diagnostics — which driver is actually live right now. */
export function activeDriverKind(): 'mock' | 'ble' {
  return cachedKind ?? pickKind();
}

export type { HardwareDriver, ProximityState, UnlockResult, UnlockError } from './types';
