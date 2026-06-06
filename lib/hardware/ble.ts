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

import type { HardwareDriver, NearbyStation, ProximityState, UnlockResult } from './types';
import { reportError } from '@/lib/telemetry';
import { stationClient } from '@/lib/ble/stationClient';
import { fetchSignedUnlock, fetchSignedReturnUnlock } from '@/lib/ble/signUnlock';
import { canAttemptBle } from '@/lib/ble/btState';
import type { StationEvent } from '@/lib/ble/protocol';
import { useSessionStore } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import {
  interpretReturnRecovery,
  type GateState,
} from './returnRecovery';

/**
 * Dispatcher for firmware-emitted BLE notifications. Called whenever an
 * EVENTS characteristic notification is decoded. Mutates the session store
 * directly via zustand `getState/setState` — safe to call outside React.
 *
 * Guards:
 *   - session_id mismatch → silently drop (the event is for a different
 *     unlock attempt, possibly stale from a prior session that didn't tear
 *     down cleanly)
 *   - dev `ignoreFirmwareTimeouts` toggle → skip timeout-class events so
 *     bench bring-up without reed switches doesn't spam the session
 */
/**
 * Module-level "a return is mid-flight" marker. Set by `returnGate` the moment
 * `return_unlock` is written and we begin awaiting `gate_closed`; cleared once
 * the return is confirmed (event or recovery) or the user navigates away. The
 * disconnect handler in `watchStation` reads this to decide whether a dropped
 * link should kick off the INFO-re-read recovery loop.
 *
 * Tracked here (not in React state) because the BLE disconnect callback fires
 * outside the component tree and must work even if the play screen is
 * backgrounded.
 */
type ReturnInFlight = {
  stationId: string;
  stationName: string;
  gate: number;
  sessionId: string;
  /** Guards against two concurrent recovery loops for the same drop. */
  recovering: boolean;
};
let returnInFlight: ReturnInFlight | null = null;

function clearReturnInFlight(): void {
  returnInFlight = null;
}

function dispatchStationEvent(event: StationEvent): void {
  const session = useSessionStore.getState().active;
  const ignoreTimeouts = useDevStore.getState().ignoreFirmwareTimeouts;

  switch (event.event) {
    case 'gate_closed': {
      if (!session || !session.bleSessionId) return;
      if (event.session_id !== session.bleSessionId) return;
      // A real gate_closed wins over any in-progress recovery loop — stop it
      // from also confirming (idempotent on the store, but cheap to short).
      clearReturnInFlight();
      useSessionStore.getState().markReturnConfirmed();
      return;
    }
    case 'unlock_timeout': {
      if (ignoreTimeouts) return;
      if (!session || !session.bleSessionId) return;
      if (event.session_id !== session.bleSessionId) return;
      useSessionStore.getState().markFirmwareEvent('unlock_timeout');
      return;
    }
    case 'return_timeout': {
      if (ignoreTimeouts) return;
      if (!session || !session.bleSessionId) return;
      if (event.session_id !== session.bleSessionId) return;
      useSessionStore.getState().markFirmwareEvent('return_timeout');
      return;
    }
    case 'ball_overdue': {
      if (ignoreTimeouts) return;
      if (!session || !session.bleSessionId) return;
      if (event.session_id !== session.bleSessionId) return;
      useSessionStore.getState().markFirmwareEvent('ball_overdue');
      return;
    }
    case 'boot': {
      // Firmware booted. If there's an active session, the station almost
      // certainly lost its NVS state (or it was preserved — but we should
      // surface this either way so the user can verify their gear).
      if (!session) return;
      useSessionStore.getState().markFirmwareEvent('station_reboot');
      return;
    }
    case 'gate_opened':
    case 'battery_low':
      // Not consumed by app state today; safe to drop. Surfaces via
      // serial-log monitoring for diagnostics.
      return;
  }
}

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

/**
 * Pre-flight gate: read the LIVE Bluetooth radio state before attempting an
 * unlock/return. If the radio is not usable, throw an Error whose message is
 * crafted so the existing `classifyError` maps it to the right localized
 * prompt — WITHOUT firing a doomed scan/write first.
 *
 * Mapping into classifyError's substring matcher:
 *   - off          → "powered off"  → bluetooth_off  ("bluetooth'u açıp tekrar dene")
 *   - unauthorized → "unauthorized" → permission_denied
 *   - unsupported  → "unsupported"  → unsupported
 *   - transient    → no dedicated "try again" code exists, so fall back to
 *                    "powered off" (bluetooth_off) per spec. The radio just
 *                    isn't ready yet; the user retry path is the same prompt.
 *
 * The existing post-failure classification stays as a backstop for the case
 * where the radio flips off mid-flight after this check passes.
 */
async function preflightRadio(): Promise<void> {
  const state = await stationClient.currentState();
  const decision = canAttemptBle(state);
  if (decision.ok) return;
  switch (decision.reason) {
    case 'unauthorized':
      throw new Error('BLE unauthorized — permission not granted');
    case 'unsupported':
      throw new Error('BLE unsupported on this device');
    case 'off':
    case 'transient':
    default:
      // 'transient' has no dedicated try-again code; fall back to bluetooth_off.
      throw new Error('Bluetooth is powered off');
  }
}

const VALID_GATE_STATES: readonly GateState[] = [
  'LOCKED',
  'UNLOCKED',
  'IN_USE',
  'RETURN_UNLOCKED',
  'UNKNOWN',
];

/**
 * Pull the (state, session_id) for ONE gate out of a `readInfo()` JSON blob.
 *
 * The firmware INFO shape is still evolving (today's PlayboxStation_3gate only
 * advertises station-level fields: station_id/fw/gates/battery_pct — see
 * firmware assumption in the task report). So be defensive and accept several
 * plausible per-gate layouts, returning `UNKNOWN` state when we genuinely
 * can't tell. `gate` is 1-indexed (matches the session's stored gate).
 *
 * Shapes tolerated:
 *   - { gate_states: ["LOCKED", "RETURN_UNLOCKED", ...],
 *       gate_sessions: ["", "sess-..", ...] }
 *   - { gates: [ { state, session_id }, ... ] }   (array of per-gate objects)
 *   - { gates: [ "LOCKED", ... ] }                (array of state strings)
 *   - { gate1: { state, session_id }, gate2: {...} }  (keyed objects)
 */
function extractGate(
  info: unknown,
  gate: number,
): { state: GateState; sessionId: string | null } {
  const unknown = { state: 'UNKNOWN' as GateState, sessionId: null };
  if (!info || typeof info !== 'object') return unknown;
  const obj = info as Record<string, unknown>;
  const idx = gate - 1; // 1-indexed gate → 0-indexed array slot

  const normState = (v: unknown): GateState =>
    typeof v === 'string' && (VALID_GATE_STATES as string[]).includes(v)
      ? (v as GateState)
      : 'UNKNOWN';
  const normSession = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;

  // (a) parallel arrays: gate_states[] / gate_sessions[]
  if (Array.isArray(obj.gate_states)) {
    const state = normState(obj.gate_states[idx]);
    const sessions = Array.isArray(obj.gate_sessions) ? obj.gate_sessions : [];
    return { state, sessionId: normSession(sessions[idx]) };
  }

  // (b) gates[] — array of per-gate objects OR plain state strings
  if (Array.isArray(obj.gates)) {
    const entry = obj.gates[idx];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      return {
        state: normState(e.state ?? e.gate_state),
        sessionId: normSession(e.session_id ?? e.sessionId),
      };
    }
    if (typeof entry === 'string') {
      return { state: normState(entry), sessionId: null };
    }
    // `gates` is a number (count) in the current firmware — no per-gate data.
    return unknown;
  }

  // (c) keyed object: { gate1: {...}, gate2: {...} } or { "1": {...} }
  const keyed = (obj[`gate${gate}`] ?? obj[String(gate)]) as unknown;
  if (keyed && typeof keyed === 'object') {
    const e = keyed as Record<string, unknown>;
    return {
      state: normState(e.state ?? e.gate_state),
      sessionId: normSession(e.session_id ?? e.sessionId),
    };
  }

  return unknown;
}

const RECOVERY_START_ATTEMPTS = 3;
const RECOVERY_KEEP_WAITING_DELAY_MS = 1_500;

/**
 * Recover a return that lost its BLE link before `gate_closed` arrived.
 *
 * Best-effort + idempotent: reconnect by station name, read INFO, interpret
 * the gate's state via the pure `interpretReturnRecovery`, and act. A real
 * `gate_closed` event arriving mid-loop clears `returnInFlight` and wins.
 * Does nothing destructive — only ever `markReturnConfirmed()` (same effect as
 * a gate_closed event) or resends a signed `return_unlock`, never penalizes.
 */
async function runReturnRecovery(target: ReturnInFlight): Promise<void> {
  let attemptsRemaining = RECOVERY_START_ATTEMPTS;

  while (attemptsRemaining > 0) {
    // A real event landed (or the user/session moved on) — stop.
    if (returnInFlight !== target) return;

    let infoGateState: GateState = 'UNKNOWN';
    let infoSessionId: string | null = null;
    try {
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(target.stationName, SCAN_TIMEOUT_MS);
      }
      const info = await stationClient.readInfo();
      const g = extractGate(info, target.gate);
      infoGateState = g.state;
      infoSessionId = g.sessionId;
    } catch (e) {
      // Reconnect / read failed this round → UNKNOWN, let the decision pick
      // keep_waiting vs manual based on attempts.
      reportError(e as Error, { source: 'ble.returnRecovery.read', stationId: target.stationId });
      infoGateState = 'UNKNOWN';
      infoSessionId = null;
    }

    if (returnInFlight !== target) return; // event won while we were reading

    const decision = interpretReturnRecovery({
      gotGateClosedEvent: useSessionStore.getState().active?.returnConfirmed === true,
      infoGateState,
      infoSessionId,
      expectedSessionId: target.sessionId,
      attemptsRemaining,
    });

    if (decision === 'confirmed_closed') {
      clearReturnInFlight();
      useSessionStore.getState().markReturnConfirmed();
      return;
    }

    if (decision === 'manual_fallback') {
      // Stop auto-recovery; the manual "kapattım" path in play.tsx stays
      // available. Surface a gentle nudge so the user knows to confirm.
      clearReturnInFlight();
      useSessionStore.getState().markFirmwareEvent('return_timeout');
      return;
    }

    if (decision === 'retry_return') {
      try {
        const signed = await fetchSignedReturnUnlock({
          stationId: target.stationId,
          gate: target.gate,
          sessionId: target.sessionId,
          devBypass: target.stationId === 'DEV-001',
        });
        if (!stationClient.isConnected()) {
          await stationClient.scanAndConnect(target.stationName, SCAN_TIMEOUT_MS);
        }
        await stationClient.returnUnlock(signed, target.stationName);
      } catch (e) {
        reportError(e as Error, {
          source: 'ble.returnRecovery.retry',
          stationId: target.stationId,
        });
      }
      attemptsRemaining -= 1;
      await new Promise((r) => setTimeout(r, RECOVERY_KEEP_WAITING_DELAY_MS));
      continue;
    }

    // keep_waiting → short delay, then re-read (consumes one attempt so we
    // can't spin forever on a permanently-unreadable link).
    attemptsRemaining -= 1;
    await new Promise((r) => setTimeout(r, RECOVERY_KEEP_WAITING_DELAY_MS));
  }

  // Out of attempts without a confirm → never silently strand: hand off to
  // the manual path with a nudge (mirrors the manual_fallback branch).
  if (returnInFlight === target) {
    clearReturnInFlight();
    useSessionStore.getState().markFirmwareEvent('return_timeout');
  }
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
          // 8s gives iOS enough time to spin up its scan + find the device
          // + establish the GATT link. 3s was missing connections on
          // first try, especially right after the app launches when the
          // BLE radio is still warming up.
          const device = await stationClient.scanAndConnect(targetName, 8000);
          if (cancelled) {
            device.cancelConnection().catch(() => {});
            return;
          }
          onChange({ kind: 'in_range', rssi: -55, lastSeenAt: Date.now() });

          // Subscribe to the EVENTS characteristic. We don't strictly need
          // every event right now — the important thing is that having an
          // active notification subscription tells iOS the link is "in
          // use," so it stops idling out the connection between user taps
          // and RETURN responds instantly instead of needing a 2-3s
          // reconnect dance.
          try {
            stationClient.subscribeToEvents(
              (evt) => {
                // Route firmware events into app state. Guards inside the
                // dispatcher handle session-id mismatch and the
                // bench-mode timeout-ignore toggle. Wrap in try/catch so
                // a malformed event can never crash the watcher.
                try {
                  dispatchStationEvent(evt);
                } catch (err) {
                  reportError(err as Error, {
                    source: 'ble.dispatch',
                    event: evt.event,
                  });
                }
              },
              () => {
                // ignore — disconnect will surface via onDisconnected
              },
            );
          } catch {
            // subscribe failure isn't fatal — the unlock still works
          }

          cleanupDisconnect();
          disconnectSub = device.onDisconnected(() => {
            if (cancelled) return;
            cleanupDisconnect();
            onChange({ kind: 'out_of_range' });
            // If the link dropped while a return was mid-flight (return_unlock
            // sent, still waiting for gate_closed), kick off the INFO-re-read
            // recovery loop so we never strand the renter or wrongly penalize
            // them. Guard against double-launch for the same in-flight return.
            const inFlight = returnInFlight;
            if (
              inFlight &&
              !inFlight.recovering &&
              !useSessionStore.getState().active?.returnConfirmed
            ) {
              inFlight.recovering = true;
              runReturnRecovery(inFlight).catch((err) => {
                reportError(err as Error, { source: 'ble.returnRecovery' });
                if (returnInFlight === inFlight) clearReturnInFlight();
              });
            }
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

    watchNearbyStations(onSeen) {
      // Per-station throttling: don't re-emit unless the RSSI moved
      // meaningfully (>5dBm) or it's been a while since the last emit (>2s).
      // The radio fires advertisement callbacks dozens of times per second
      // with allowDuplicates on — passing every one through to React would
      // thrash re-renders for nothing.
      const lastEmit = new Map<string, { rssi: number; t: number }>();
      const RSSI_DELTA = 5;
      const MIN_INTERVAL_MS = 2_000;

      stationClient.startPassiveScan(
        (name, rssi) => {
          // Inverse of nameFromStationId. Override case maps to DEV-001.
          let stationId: string;
          if (BLE_STATION_NAME_OVERRIDE && name === BLE_STATION_NAME_OVERRIDE) {
            stationId = 'DEV-001';
          } else if (name.startsWith('Playbox-')) {
            stationId = name.slice('Playbox-'.length);
          } else {
            return;
          }
          const now = Date.now();
          const prev = lastEmit.get(stationId);
          if (prev && now - prev.t < MIN_INTERVAL_MS && Math.abs(rssi - prev.rssi) < RSSI_DELTA) {
            return;
          }
          lastEmit.set(stationId, { rssi, t: now });
          const sighting: NearbyStation = { stationId, rssi, lastSeenAt: now };
          onSeen(sighting);
        },
        (err) => {
          reportError(err, { source: 'ble.watchNearby' });
        },
      );

      return {
        stop: () => {
          stationClient.stopPassiveScan();
          lastEmit.clear();
        },
      };
    },

    async unlockGate({ stationId, gateId, correlationId, durationMin }): Promise<UnlockResult> {
      const targetName = nameFromStationId(stationId);
      const gate = parseGateIndex(gateId);

      try {
        // Pre-flight: gate on the LIVE radio state before doing anything
        // network- or scan-bound. If Bluetooth is off/unauthorized/unsupported
        // (or not yet ready), throw early so we surface the localized prompt
        // WITHOUT a doomed scan/write. classifyError maps the message below.
        await preflightRadio();

        // Get signed BLE payload from the server. Server checks JWT + active
        // payment hold before signing — without those, no signature, no
        // unlock. Phone never holds the station secret.
        // session_id is the firmware's handle for matching a later
        // return_unlock to this unlock; correlationId is unique per attempt
        // and stable for the duration of the session, so it doubles as it.
        //
        // DEV-001 auto-bypass: the server only honors dev_bypass when
        // station_id === 'DEV-001', so passing it for any other station is
        // a no-op. This lets the Oyna flow work on the dev unit without a
        // card on file (Phase 0 bench testing).
        const signed = await fetchSignedUnlock({
          stationId,
          gate,
          sessionId: correlationId,
          durationMin,
          devBypass: stationId === 'DEV-001',
          // The reservation-linkage slug (e.g. DEV-001-football-1). The server
          // only links the unlock to a reservation when this is present; the
          // numeric `gate` above stays as-is for the BLE HMAC.
          gateId,
        });

        if (!stationClient.isConnected()) {
          await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
        }
        // Thread the station's BLE name so a mid-write reconnect can re-target
        // it by name (otherwise the retry falls back to lastSeenDevice?.name).
        await stationClient.unlock(signed, targetName);
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

    async returnGate({ stationId, gate, sessionId, correlationId }): Promise<UnlockResult> {
      const targetName = nameFromStationId(stationId);
      try {
        // Pre-flight: gate on the LIVE radio state before signing/scanning so
        // we never fire a doomed return write when Bluetooth isn't usable.
        await preflightRadio();

        // Same signing path as unlock — server enforces auth, then signs the
        // return_unlock payload bound to gate + sessionId. The phone replays
        // the exact session_id the firmware is holding, otherwise firmware
        // silently rejects. DEV-001 auto-bypass mirrors unlockGate.
        const signed = await fetchSignedReturnUnlock({
          stationId,
          gate,
          sessionId,
          devBypass: stationId === 'DEV-001',
        });
        if (!stationClient.isConnected()) {
          await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
        }
        // Thread the station's BLE name so a mid-write reconnect can re-target
        // it by name (otherwise the retry falls back to lastSeenDevice?.name).
        await stationClient.returnUnlock(signed, targetName);
        // Return write landed — we're now awaiting gate_closed. Mark the
        // return as in-flight so a subsequent disconnect triggers recovery.
        returnInFlight = {
          stationId,
          stationName: targetName,
          gate,
          sessionId,
          recovering: false,
        };
        return { ok: true, openedAt: Date.now() };
      } catch (e) {
        // Return write failed outright — no in-flight return to recover.
        clearReturnInFlight();
        const kind = classifyError(e);
        reportError(e as Error, { source: 'ble.return', stationId, gate, correlationId });
        if (kind === 'bluetooth_off') return { ok: false, error: 'bluetooth_off' };
        if (kind === 'permission_denied') return { ok: false, error: 'permission_denied' };
        if (kind === 'unsupported') return { ok: false, error: 'unsupported' };
        if (kind === 'out_of_range') return { ok: false, error: 'not_in_range' };
        return { ok: false, error: 'connection_failed', message: String((e as Error)?.message ?? e) };
      }
    },

    reset() {
      clearReturnInFlight();
      stationClient.disconnect().catch(() => {});
    },
  };
}

export type { ProximityState };
