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
  // Only honor the override for the DEV-001 dev workshop. Otherwise the
  // breadboard would falsely satisfy proximity for every Istanbul station
  // in the seed map — picking Taksim across the city would show "in range"
  // just because the dev unit is on your desk.
  if (BLE_STATION_NAME_OVERRIDE && stationId.toUpperCase() === 'DEV-001') {
    return BLE_STATION_NAME_OVERRIDE;
  }
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
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let disconnectSub: { remove: () => void } | null = null;

      // Connection-based proximity. Scan-based proximity is flaky on iOS
      // (callbacks come in bursts, dropouts cause the banner to flicker
      // between "in range" and "yaklaş"). Once we've successfully
      // connected to the ESP32, the OS tells us *deterministically* when
      // the link drops — much more stable than counting missed adverts.
      //
      // Cadence:
      //   - 3s scan window → in_range on connect, out_of_range on timeout
      //   - on disconnect, retry every 3s so we re-detect when the user
      //     walks back into range without needing to re-mount the screen.

      const cleanupDisconnect = () => {
        if (disconnectSub) {
          try {
            disconnectSub.remove();
          } catch {
            // already removed — ignore
          }
          disconnectSub = null;
        }
      };

      const armRetry = (delayMs: number) => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (!cancelled) attempt();
        }, delayMs);
      };

      const attempt = async () => {
        if (cancelled) return;
        onChange({ kind: 'scanning' });
        try {
          const device = await stationClient.scanAndConnect(targetName, 3000);
          if (cancelled) {
            device.cancelConnection().catch(() => {});
            return;
          }
          onChange({ kind: 'in_range', rssi: -55, lastSeenAt: Date.now() });

          cleanupDisconnect();
          disconnectSub = device.onDisconnected(() => {
            if (cancelled) return;
            cleanupDisconnect();
            onChange({ kind: 'out_of_range' });
            armRetry(3000);
          });
        } catch (e) {
          if (cancelled) return;
          const kind = classifyError(e);
          if (kind === 'bluetooth_off') {
            onChange({ kind: 'bluetooth_off' });
            armRetry(5000);
          } else if (kind === 'permission_denied') {
            onChange({ kind: 'permission_denied' });
            // Needs user action — don't auto-retry.
          } else if (kind === 'unsupported') {
            onChange({ kind: 'unsupported' });
          } else {
            // out_of_range or connection_failed — keep trying so we pick
            // up when the user walks closer.
            onChange({ kind: 'out_of_range' });
            armRetry(3000);
          }
        }
      };

      attempt();

      return {
        stop: () => {
          cancelled = true;
          if (retryTimer) clearTimeout(retryTimer);
          cleanupDisconnect();
          // Don't disconnect on unmount — the unlock screen reuses the
          // same connection. Disconnecting would force a fresh handshake.
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
