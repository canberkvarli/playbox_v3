/**
 * Real-hardware driver. Talks to the station directly over BLE via the
 * shared `stationClient` (single BleManager instance, single connection).
 *
 * Phase 0 (breadboard): proximity check = "can we scan-and-connect to the
 * advertised name?" — not RSSI. This avoids running two BLE scans (one for
 * proximity, one for unlock) which fight on iOS. Once the connection is up,
 * unlock is a JSON write to the unlock characteristic.
 *
 * Station-name resolution:
 *   - If EXPO_PUBLIC_BLE_STATION_NAME is set, every stationId maps to that
 *     name. Use this when testing one breadboard against the seed map.
 *   - Otherwise we derive `Playbox-${UPPER_STATION_ID}` to match the
 *     firmware's `Playbox-DEV-001`-style advertising convention.
 */

import type { HardwareDriver, ProximityState, UnlockResult } from './types';
import { reportError } from '@/lib/telemetry';
import { stationClient } from '@/lib/ble/stationClient';
import { fetchSignedUnlock } from '@/lib/ble/signUnlock';

const BLE_STATION_NAME_OVERRIDE = process.env.EXPO_PUBLIC_BLE_STATION_NAME;
const SCAN_TIMEOUT_MS = 8_000;

function nameFromStationId(stationId: string): string {
  if (BLE_STATION_NAME_OVERRIDE) return BLE_STATION_NAME_OVERRIDE;
  return `Playbox-${stationId.toUpperCase()}`;
}

/** gateId convention is `${stationId}-${sport}-${index}`; pull the index. */
function parseGateIndex(gateId: string): number {
  const tail = gateId.split('-').pop() ?? '';
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function classifyError(e: unknown): ProximityState['kind'] | 'connection_failed' {
  const msg = String((e as Error)?.message ?? e ?? '').toLowerCase();
  if (msg.includes('powered off') || msg.includes('poweredoff')) return 'bluetooth_off';
  if (msg.includes('unauthorized') || msg.includes('permission')) return 'permission_denied';
  if (msg.includes('unsupported')) return 'unsupported';
  if (msg.includes('timeout') || msg.includes('not found')) return 'out_of_range';
  return 'connection_failed';
}

export function createBleDriver(): HardwareDriver {
  return {
    watchStation(stationId, onChange) {
      const targetName = nameFromStationId(stationId);
      let cancelled = false;

      onChange({ kind: 'scanning' });

      // Connect-and-stay. If we connect, we report in_range and keep the
      // device handle warm so a subsequent unlockGate is a single write.
      // If we fail, classify the error so the UI can prompt correctly.
      (async () => {
        try {
          if (!stationClient.isConnected()) {
            await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
          }
          if (cancelled) return;
          onChange({ kind: 'in_range', rssi: -55, lastSeenAt: Date.now() });
        } catch (e) {
          if (cancelled) return;
          const kind = classifyError(e);
          if (kind === 'bluetooth_off') onChange({ kind: 'bluetooth_off' });
          else if (kind === 'permission_denied') onChange({ kind: 'permission_denied' });
          else if (kind === 'unsupported') onChange({ kind: 'unsupported' });
          else onChange({ kind: 'out_of_range' });
        }
      })();

      return {
        stop: () => {
          cancelled = true;
          // Don't disconnect on unmount — the unlock screen and the play
          // screen are different mounts but share the same physical link.
        },
      };
    },

    async unlockGate({ stationId, gateId, correlationId }): Promise<UnlockResult> {
      const targetName = nameFromStationId(stationId);
      const gate = parseGateIndex(gateId);

      try {
        // Get signed BLE payload from the server. Server checks JWT + active
        // payment hold before signing — without those, no signature, no
        // unlock. Phone never holds the station secret.
        // session_id is the firmware's handle for matching a later
        // return_unlock to this unlock; correlationId is unique per attempt
        // and stable for the duration of the session, so it doubles as it.
        const signed = await fetchSignedUnlock({
          stationId,
          gate,
          sessionId: correlationId,
          durationMin: 30,
        });

        if (!stationClient.isConnected()) {
          await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
        }
        await stationClient.unlock(signed);
        return { ok: true, openedAt: Date.now() };
      } catch (e) {
        const kind = classifyError(e);
        reportError(e as Error, { source: 'ble.unlock', stationId, gateId });
        if (kind === 'bluetooth_off') return { ok: false, error: 'bluetooth_off' };
        if (kind === 'permission_denied') return { ok: false, error: 'permission_denied' };
        if (kind === 'unsupported') return { ok: false, error: 'unsupported' };
        if (kind === 'out_of_range') return { ok: false, error: 'not_in_range' };
        return { ok: false, error: 'connection_failed', message: String((e as Error)?.message ?? e) };
      }
    },

    reset() {
      stationClient.disconnect().catch(() => {});
    },
  };
}

export type { ProximityState };
