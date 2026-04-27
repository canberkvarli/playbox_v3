/**
 * Real-hardware driver. Uses react-native-ble-plx to scan for the station's
 * BLE advertisement and supabase Edge Functions to dispatch the unlock.
 *
 * THIS FILE HAS TWO HARDWARE-SPECIFIC CONSTANTS THAT YOU MUST FILL IN
 * before flipping the production switch:
 *
 *   1. PLAYBOX_BLE_SERVICE_UUID  — the 128-bit service UUID your gates
 *      advertise. Get it from the firmware spec.
 *   2. The advertising-name format under `nameFromStationId`. Right now
 *      the placeholder assumes `pbox-${stationId}`. If your firmware
 *      uses a different convention (MAC suffix, sequential ID), update it.
 *
 * The unlock command goes through the `gate-unlock` Supabase Edge Function
 * (server-mediated MQTT). Direct BLE write to the gate is intentionally
 * NOT supported — it would let a rooted phone bypass session/payment
 * checks. Server roundtrip cost is ~250ms which is acceptable for an
 * unlock flow that already has theatrics.
 */

import type { HardwareDriver, ProximityState, UnlockResult } from './types';
import { reportError } from '@/lib/telemetry';

// Lazy-load the native module so dev environments without it (web, jest)
// don't crash at import time.
let BleManager: any = null;
function loadBle() {
  if (BleManager !== null) return BleManager;
  try {
    BleManager = require('react-native-ble-plx').BleManager;
    return BleManager;
  } catch {
    BleManager = false;
    return null;
  }
}

// ────────────────────────── HARDWARE-SPECIFIC ─────────────────────────────

/** TODO: replace with the real service UUID once firmware spec is final. */
const PLAYBOX_BLE_SERVICE_UUID = '00000000-0000-1000-8000-00805f9b34fb';

/** RSSI threshold for "in range". Closer = larger (less negative). */
const IN_RANGE_RSSI = -85;

/** How long without a scan hit before we flip back to out_of_range. */
const PROXIMITY_TTL_MS = 6_000;

/**
 * Translate a station id ("ist-kadikoy") into the local-name fragment the
 * gate advertises. Gates broadcast as e.g. "pbox-ist-kadikoy-1" where the
 * trailing number is the gate index. Adjust this when firmware locks the
 * naming scheme.
 */
function nameFromStationId(stationId: string): string {
  return `pbox-${stationId}`;
}

// ─────────────────────────── DRIVER IMPL ──────────────────────────────────

let bleManagerInstance: any = null;
function getManager(): any {
  if (bleManagerInstance) return bleManagerInstance;
  const M = loadBle();
  if (!M) return null;
  bleManagerInstance = new M();
  return bleManagerInstance;
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const UNLOCK_TIMEOUT_MS = 8_000;

export function createBleDriver(): HardwareDriver {
  return {
    watchStation(stationId, onChange) {
      const manager = getManager();
      if (!manager) {
        onChange({ kind: 'unsupported' });
        return { stop: () => {} };
      }

      const targetName = nameFromStationId(stationId);
      let lastSeenAt = 0;
      let ttlTimer: ReturnType<typeof setInterval> | null = null;
      let scanning = false;

      const stop = () => {
        try {
          manager.stopDeviceScan();
        } catch {}
        if (ttlTimer) {
          clearInterval(ttlTimer);
          ttlTimer = null;
        }
        scanning = false;
      };

      // Permission + adapter state check. On iOS the system prompt fires
      // automatically the first time we start a scan, so we just react to
      // whatever state lands.
      const stateSubscription = manager.onStateChange((state: string) => {
        if (state === 'PoweredOn') {
          if (scanning) return;
          scanning = true;
          onChange({ kind: 'scanning' });
          manager.startDeviceScan(
            [PLAYBOX_BLE_SERVICE_UUID],
            { allowDuplicates: true },
            (err: Error | null, device: any) => {
              if (err) {
                if (String(err.message ?? '').toLowerCase().includes('permission')) {
                  onChange({ kind: 'permission_denied' });
                } else {
                  reportError(err, { source: 'ble.scan', stationId });
                  onChange({ kind: 'out_of_range' });
                }
                return;
              }
              if (!device) return;
              const localName = device.localName ?? device.name ?? '';
              if (!localName.startsWith(targetName)) return;
              if (typeof device.rssi !== 'number') return;
              if (device.rssi < IN_RANGE_RSSI) return;
              lastSeenAt = Date.now();
              onChange({
                kind: 'in_range',
                rssi: device.rssi,
                lastSeenAt,
              });
            },
          );
          // TTL watchdog: if we haven't seen the device in PROXIMITY_TTL_MS,
          // flip back to out_of_range. Keeps the UI honest if the user walks
          // away mid-flow.
          ttlTimer = setInterval(() => {
            if (lastSeenAt && Date.now() - lastSeenAt > PROXIMITY_TTL_MS) {
              onChange({ kind: 'out_of_range' });
            }
          }, 1000);
        } else if (state === 'PoweredOff') {
          onChange({ kind: 'bluetooth_off' });
        } else if (state === 'Unauthorized') {
          onChange({ kind: 'permission_denied' });
        } else if (state === 'Unsupported') {
          onChange({ kind: 'unsupported' });
        }
      }, true);

      return {
        stop: () => {
          try {
            stateSubscription?.remove?.();
          } catch {}
          stop();
        },
      };
    },

    async unlockGate({ stationId, gateId, sessionToken, correlationId }): Promise<UnlockResult> {
      if (!SUPABASE_URL) {
        return { ok: false, error: 'network', message: 'supabase URL not configured' };
      }
      const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/gate-unlock`;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), UNLOCK_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
            'X-Correlation-Id': correlationId,
          },
          body: JSON.stringify({ station_id: stationId, gate_id: gateId, correlation_id: correlationId }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (res.status === 401 || res.status === 403) {
            return { ok: false, error: 'auth_rejected', message: text };
          }
          if (res.status === 409) {
            return { ok: false, error: 'gate_busy', message: text };
          }
          return { ok: false, error: 'unknown', message: `${res.status} ${text}` };
        }

        const json = await res.json().catch(() => null);
        if (!json?.ok) {
          return { ok: false, error: 'unknown', message: 'bad_response' };
        }
        return { ok: true, openedAt: Date.now() };
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          return { ok: false, error: 'timeout' };
        }
        reportError(e, { source: 'ble.unlock', stationId, gateId });
        return { ok: false, error: 'network', message: String(e?.message ?? e) };
      } finally {
        clearTimeout(timer);
      }
    },

    reset() {
      try {
        bleManagerInstance?.stopDeviceScan?.();
      } catch {}
    },
  };
}

export type { ProximityState };
