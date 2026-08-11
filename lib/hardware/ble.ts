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
import { supabase } from '@/lib/supabase';
import { stationClient } from '@/lib/ble/stationClient';
import { fetchSignedUnlock, fetchSignedReturnUnlock } from '@/lib/ble/signUnlock';
import { canAttemptBle } from '@/lib/ble/btState';
import type { StationEvent } from '@/lib/ble/protocol';
import { buildIngestBatch, pickAckedSeq, isSignedEvent } from './relay';
import {
  planGossipDrain,
  buildAckCommand,
  coalesceRelayQueue,
} from './gossip';
import { useSessionStore } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import { useNearbyStore } from '@/stores/nearbyStore';
import { isFreshlyPresent } from './proximity';
import {
  interpretReturnRecovery,
  type GateState,
} from './returnRecovery';
import { extractGate } from './infoGate';
import { shouldReattach } from './coldLaunch';
import { awaitGateOpened, GATE_OPEN_CONFIRM_MS } from './gateConfirm';

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

/**
 * Last `acked_seq` the server returned from an `ingest-events` POST. Stashed
 * here (module-level, outside React) so Task 8's ack relay can read the cursor
 * and write it back to the station (e.g. as a signed `ack` command). We do NOT
 * write it back here — relay is read-only toward the station. Keyed by station
 * so a future multi-station courier can't cross-ack. null until the first
 * successful signed ingest.
 */
const lastAckedSeqByStation = new Map<string, number>();

/** Read-only accessor for the stashed ack cursor (consumed by Task 8). */
export function getLastAckedSeq(stationId: string): number | null {
  const v = lastAckedSeqByStation.get(stationId);
  return v === undefined ? null : v;
}

/**
 * Relay station-signed events to the `ingest-events` Edge Function so the
 * server can verify their HMAC and reconcile physical truth (Phase 1). The
 * renter's phone is the primary courier.
 *
 * GATED ON THE SIGNED SHAPE: `buildIngestBatch` keeps only events that carry
 * both `sig` and `seq` (the Phase 0 signed/sequenced shape) and returns null
 * if none qualify. Today's firmware emits UNSIGNED events, so this is a safe
 * NO-OP — nothing is posted — until firmware Task 5 lands and starts emitting
 * signed events, at which point this lights up automatically.
 *
 * BEST-EFFORT: any failure (network, auth, server error) is swallowed + logged
 * via the telemetry reporter. It must NEVER affect the local session/UX — the
 * local `dispatchStationEvent` path runs first and is completely unaffected.
 */
async function relayStationEvents(
  stationId: string,
  events: StationEvent[],
): Promise<void> {
  // No-op gate: returns null when no event carries the signed shape (the case
  // for ALL of today's unsigned firmware events) → skip the POST entirely.
  const batch = buildIngestBatch(stationId, events);
  if (!batch) return;

  try {
    const { data, error } = await supabase.functions.invoke('ingest-events', {
      body: batch,
    });
    if (error) {
      reportError(error as Error, { source: 'ble.relay.ingest', stationId });
      return;
    }
    // Stash the server's ack cursor for Task 8's ack relay. Read-only here —
    // we do NOT write it back to the station.
    const acked = pickAckedSeq(data);
    if (acked !== null) lastAckedSeqByStation.set(stationId, acked);
  } catch (e) {
    // Best-effort: swallow + log. Local UX is unaffected.
    reportError(e as Error, { source: 'ble.relay.ingest', stationId });
  }
}

/**
 * Per-station debounce queue for coalescing courier relays (Task 7 follow-up).
 * Instead of one `ingest-events` POST per EVENTS notification, signed events are
 * buffered per station and flushed as ONE batch after a short delay (or once a
 * size cap is hit), via the same best-effort `relayStationEvents` path.
 *
 * Unsigned events are NEVER queued (the signed-shape gate filters them), so
 * today's firmware still no-ops. Local dispatch always runs FIRST + is
 * unaffected — this queue only feeds the additive server relay.
 */
const RELAY_DEBOUNCE_MS = 400;
const RELAY_MAX_BATCH = 25;

type RelayQueue = {
  events: StationEvent[];
  timer: ReturnType<typeof setTimeout> | null;
};
const relayQueueByStation = new Map<string, RelayQueue>();

/**
 * Tear down ALL pending relay queues on logout/reset: cancel every per-station
 * flush timer (so a debounced relay can NEVER fire after sign-out, against the
 * wrong account) and drop the buffered events. Idempotent.
 */
function clearAllRelayQueues(): void {
  for (const q of relayQueueByStation.values()) {
    if (q.timer) {
      clearTimeout(q.timer);
      q.timer = null;
    }
    q.events = [];
  }
  relayQueueByStation.clear();
}

/** Flush a station's coalesced relay queue as one batch (best-effort). */
function flushRelayQueue(stationId: string): void {
  const q = relayQueueByStation.get(stationId);
  if (!q) return;
  if (q.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
  const pending = q.events;
  q.events = [];
  if (pending.length === 0) return;
  // Dedupe-by-seq + sort ascending so a batch is clean even if the same event
  // arrived twice (e.g. notification + drain overlap).
  const batch = coalesceRelayQueue(pending);
  // Fire-and-forget; relayStationEvents swallows all failures internally.
  void relayStationEvents(stationId, batch);
}

/**
 * Enqueue a single firmware event for coalesced relay. No-ops for unsigned
 * events (they'd be filtered server-side anyway). Flushes immediately once the
 * queue reaches RELAY_MAX_BATCH, otherwise debounces by RELAY_DEBOUNCE_MS.
 */
function enqueueRelayEvent(stationId: string, evt: StationEvent): void {
  if (!isSignedEvent(evt)) return; // unsigned → never queued (still a no-op today)
  let q = relayQueueByStation.get(stationId);
  if (!q) {
    q = { events: [], timer: null };
    relayQueueByStation.set(stationId, q);
  }
  q.events.push(evt);
  if (q.events.length >= RELAY_MAX_BATCH) {
    flushRelayQueue(stationId);
    return;
  }
  if (!q.timer) {
    q.timer = setTimeout(() => flushRelayQueue(stationId), RELAY_DEBOUNCE_MS);
  }
}

/**
 * Gossip-sync drain on ANY station connect (Phase 3 Task 8): even a passive
 * connection for a DIFFERENT user makes this phone a backstop courier. Steps:
 *   (a) read the station's pending SIGNED-event buffer,
 *   (b) plan what to drain (signed + seq > lastAckedSeq, sorted/deduped),
 *   (c) POST it to `ingest-events` (reuses relayStationEvents),
 *   (d) write the resulting unsigned `ack` back so the station drops events
 *       ≤ acked_seq from its NVS buffer.
 *
 * FIRMWARE-GATED NO-OP TODAY: `readPendingBuffer` returns [] because the
 * BUFFER characteristic is Phase 0 firmware Task 5 (not built) → `planGossipDrain`
 * yields [] → nothing is POSTed and no ack is written. Lights up automatically
 * once firmware Task 5 exposes the buffer-drain + ack characteristics.
 *
 * BEST-EFFORT: every step is wrapped so a gossip/ack failure can NEVER affect
 * the user's own session/UX.
 */
async function gossipSyncOnConnect(stationId: string): Promise<void> {
  try {
    // (a) Read the station's pending buffer. Returns [] today (no characteristic).
    const buffer = await stationClient.readPendingBuffer();
    // (b) Plan the drain against our last-known ack cursor for this station.
    const toDrain = planGossipDrain(buffer, getLastAckedSeq(stationId));
    if (toDrain.length === 0) return; // nothing to drain → no POST, no ack (no-op)

    // (c) POST via the existing best-effort ingest path. It stashes acked_seq
    //     into lastAckedSeqByStation on success.
    await relayStationEvents(stationId, toDrain);

    // (d) Relay the ack cursor back so the station drops acked events. Guarded:
    //     no-ops when there's nothing to ack, and writeAck swallows the case
    //     where the firmware ack handler doesn't exist yet (Task 5).
    const ack = buildAckCommand(getLastAckedSeq(stationId));
    if (ack) await stationClient.writeAck(ack);
  } catch (e) {
    // Best-effort: a gossip/ack failure must never touch the user's session.
    reportError(e as Error, { source: 'ble.gossipSync', stationId });
  }
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

// Pre-signed unlock cache. session-prep can pre-fetch the signed payload while
// the user reads the prep slides, so the final OYNA tap skips the sign-unlock
// network round-trip and the door opens sooner. Keyed by correlationId (==
// session_id). Best-effort + ADDITIVE: unlockGate falls back to a fresh fetch on
// any miss/expiry, so this can only make unlock faster, never break it.
type SignedUnlock = Awaited<ReturnType<typeof fetchSignedUnlock>>;
const prefetchedUnlocks = new Map<string, { payload: SignedUnlock; expiresAt: number }>();
const UNLOCK_PREFETCH_TTL_MS = 120_000;

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

const RECOVERY_START_ATTEMPTS = 3;
// Delay between recovery steps — used for both keep_waiting (re-read after a
// failed/UNKNOWN read) and retry_return (after resending return_unlock).
const RECOVERY_STEP_DELAY_MS = 1_500;

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
      await new Promise((r) => setTimeout(r, RECOVERY_STEP_DELAY_MS));
      continue;
    }

    // keep_waiting → short delay, then re-read (consumes one attempt so we
    // can't spin forever on a permanently-unreadable link).
    attemptsRemaining -= 1;
    await new Promise((r) => setTimeout(r, RECOVERY_STEP_DELAY_MS));
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
    watchStation(stationId, onChange, opts) {
      const targetName = nameFromStationId(stationId);
      const eager = opts?.eager === true;
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
          if (cancelled) return;
          // Coordinate the two reconnect paths: while a return recovery loop is
          // active it OWNS the link (it scanAndConnects on its own cadence).
          // Firing the passive-retry attempt() here too would race a second
          // scan/connect against the same station — iOS scan thrash. Defer:
          // re-arm and re-check next tick. Once recovery clears returnInFlight
          // (confirmed / manual / out-of-attempts / failure), normal proximity
          // retry resumes. When no return is in flight, this is a no-op and
          // armRetry behaves exactly as before.
          if (returnInFlight?.recovering) {
            armRetry(delayMs);
            return;
          }
          attempt();
        }, delayMs);
      };

      const attempt = async () => {
        if (cancelled) return;

        // A LIVE GATT CONNECTION IS PRESENCE. A BLE peripheral stops
        // advertising once a central connects to it, so right after an unlock
        // (or return) opens the link, a fresh scan can no longer *see* the
        // station and would decay to out_of_range — even though we are
        // physically connected to it this very moment. proximity.ts says it
        // plainly: "A live GATT connection during unlock is the real presence
        // proof." Encode that here: if stationClient already holds a link to
        // THIS station (name-matched, mirroring scanAndConnect's guard so a
        // DEV-001 link can't satisfy ist-taksim), report in_range with a
        // synthetic fresh lastSeenAt and skip the doomed scan entirely.
        if (stationClient.connectedName() === targetName) {
          onChange({ kind: 'in_range', rssi: -55, lastSeenAt: Date.now() });
          // Re-arm so we keep re-affirming presence on the normal cadence; the
          // OS disconnect callback (wired on the original connect) still flips
          // us to out_of_range the instant the link actually drops.
          armRetry(3000);
          return;
        }

        // A RECENT PASSIVE ADVERTISEMENT SIGHTING IS ALSO PRESENCE. The map's
        // green dot comes from the lightweight passive scan (watchNearbyStations
        // → nearbyStore); if that scan heard THIS station's advert within the
        // proximity freshness window, the station is physically here even when a
        // connect-based check would stall (busy/contended peripheral, iOS scan
        // contention, transient connect timeout) and wrongly decay to
        // out_of_range. Treat a fresh sighting as in_range so the panel agrees
        // with the map, WITHOUT starting a competing scan — we READ the same
        // sightings the map already populates (iOS allows only one active scan).
        //
        // Matched strictly by stationId (nearbyStore keys by
        // stationId.toUpperCase(), the inverse of the name match above) so a
        // DEV-001 sighting can't satisfy another station. When the sighting goes
        // stale AND we aren't connected, isFreshlyPresent returns false and we
        // fall through to the real scanAndConnect, which decays to out_of_range
        // exactly as before. The unlock/return still does scanAndConnect as the
        // source of truth — this only affects the presence banner.
        // EAGER mode (the unlock screen) intentionally skips this passive-sighting
        // short-circuit: a fresh advert proves the station is HERE, but it does
        // NOT open a link. We want the link actually established before OYNA, so
        // fall through to scanAndConnect below and hold it. Non-eager watchers
        // (map, etc.) keep resting on the sighting to avoid needless connects.
        const sighting =
          useNearbyStore.getState().seen[stationId.toUpperCase()] ?? null;
        if (!eager && isFreshlyPresent(sighting, Date.now())) {
          onChange({
            kind: 'in_range',
            rssi: sighting!.rssi,
            lastSeenAt: sighting!.lastSeenAt,
          });
          // Re-check on the normal cadence: when the advert stops being heard,
          // the next tick finds a stale sighting and (below) decays to
          // out_of_range WITHOUT opening a link.
          armRetry(3000);
          return;
        }

        // PRESENCE NEVER CONNECTS. For an idle non-eager watcher with no live
        // link and no fresh advert, do NOT scanAndConnect just to probe presence.
        // A held GATT link makes the ESP32 stop advertising (station reads
        // "offline" everywhere) AND races the user's real tap — two scan/connects
        // against one peripheral cancel each other on iOS ("not connected").
        // This background probe was the residual warm-connect that fought every
        // tap. Rest as out_of_range and keep listening passively; a fresh advert
        // or an explicit tap (unlock/return — the real source of truth) brings us
        // back. The ONE exception: a return that's genuinely mid-flight, whose
        // recovery loop needs the link re-established — let that through.
        if (!eager && !returnInFlight) {
          onChange({ kind: 'out_of_range' });
          armRetry(3000);
          return;
        }

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
                // Additive, best-effort courier relay — runs AFTER the local
                // dispatch above so local UX is first + completely unaffected.
                // COALESCED (Task 7 follow-up): instead of one POST per event,
                // enqueue into a per-station debounce queue that flushes as ONE
                // batch after ~400ms (or at a size cap). Unsigned events are
                // never queued, so today's UNSIGNED firmware is still a verified
                // no-op; this lights up once firmware Task 5 emits signed events.
                enqueueRelayEvent(stationId, evt);
              },
              () => {
                // ignore — disconnect will surface via onDisconnected
              },
            );
          } catch {
            // subscribe failure isn't fatal — the unlock still works
          }

          // Gossip-sync drain (Task 8): on ANY connect — even a passive watch
          // for a different user — act as a backstop courier: drain the
          // station's pending signed-event buffer, POST it, and ack back so the
          // station can drop acked events. Fire-and-forget + best-effort:
          // failures are swallowed inside and can't touch the user's session.
          // NO-OPS today — the BUFFER characteristic is firmware Task 5, so
          // readPendingBuffer() returns [] → planGossipDrain() yields [].
          void gossipSyncOnConnect(stationId);

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

      // Refcounted: several screens watch presence at once, so we must drop only
      // OUR subscription on unmount — a blanket stop would kill the map's.
      const token = stationClient.startPassiveScan(
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
          stationClient.stopPassiveScan(token);
          lastEmit.clear();
        },
      };
    },

    async prefetchUnlock({ stationId, gate: gateArg, gateId, correlationId, durationMin }): Promise<void> {
      // Sign the unlock NOW (in the background) so the eventual unlockGate call
      // for this same correlationId can skip the round-trip. Best-effort: a
      // failure (e.g. a real station with no payment hold yet) just leaves the
      // cache empty and unlockGate signs fresh. Mirrors unlockGate's gate +
      // devBypass derivation so the cached payload is byte-identical to what a
      // fresh sign would produce.
      const gate =
        typeof gateArg === 'number' && gateArg >= 1
          ? Math.floor(gateArg)
          : gateId
          ? parseGateIndex(gateId)
          : 1;
      try {
        const signed = await fetchSignedUnlock({
          stationId,
          gate,
          sessionId: correlationId,
          durationMin,
          devBypass: stationId === 'DEV-001',
          gateId,
        });
        prefetchedUnlocks.set(correlationId, {
          payload: signed,
          expiresAt: Date.now() + UNLOCK_PREFETCH_TTL_MS,
        });
      } catch {
        // best-effort — unlockGate will sign fresh on a miss
      }
    },

    async unlockGate({ stationId, gate: gateArg, gateId, correlationId, durationMin }): Promise<UnlockResult> {
      const targetName = nameFromStationId(stationId);
      // Numeric gate for the BLE HMAC. Prefer the explicit 1-indexed compartment
      // from the caller (stable, independent of the linkage slug); fall back to
      // parsing the slug only when no explicit gate was provided (back-compat).
      // Defaults to 1 when neither is available.
      const gate =
        typeof gateArg === 'number' && gateArg >= 1
          ? Math.floor(gateArg)
          : gateId
          ? parseGateIndex(gateId)
          : 1;

      // A fresh unlock starts a brand-new session: it must never inherit a
      // prior return's in-flight marker (e.g. a recovery loop that never
      // cleared across sessions/stations, or a stale return from a previous
      // play). Clear it up front so the disconnect handler can't mistakenly
      // treat this new unlock's drops as a return-in-flight to recover.
      clearReturnInFlight();

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
        // Use a pre-signed payload if session-prep pre-fetched one for this
        // correlationId and it hasn't expired — saves the sign-unlock round trip
        // so the door opens sooner. Consume the cache entry either way; on a
        // miss/expiry, sign fresh (unchanged behavior). The pre-fetch used the
        // SAME stationId/gate/correlationId/durationMin/gateId, so the cached
        // payload is identical to a fresh sign.
        const cached = prefetchedUnlocks.get(correlationId);
        prefetchedUnlocks.delete(correlationId);
        // Sign helper. Attempt 1 reuses the pre-signed payload if session-prep
        // cached one; every RETRY signs fresh so it carries a new (monotonic)
        // ts — the firmware rejects a replayed ts, so a stale payload could
        // never succeed on a second attempt.
        const signUnlock = () =>
          fetchSignedUnlock({
            stationId,
            gate,
            sessionId: correlationId,
            durationMin,
            devBypass: stationId === 'DEV-001',
            // The reservation-linkage slug (e.g. DEV-001-football-1). The
            // server only links the unlock to a reservation when this is
            // present; the numeric `gate` above stays as-is for the BLE HMAC.
            gateId,
          });

        // Connect → write → await gate_opened, with a small retry. The link now
        // drops as a plain BLE supervision timeout (HCI 0x08 / reason 520) or a
        // remote-terminate (0x13 / 531) and the ESP32 stays UP and re-advertises
        // within ~1s — so a single-shot attempt that happens to catch a drop
        // fails the whole rental, while a human on the debug screen just
        // reconnects and taps again. This loop IS that human. Re-unlocking an
        // already-open gate is a firmware no-op (it only pulses a LOCKED gate),
        // so a retry never double-fires the solenoid.
        const MAX_UNLOCK_ATTEMPTS = 3;
        let lastErr: unknown = new Error('unlock: no attempt made');
        for (let attempt = 1; attempt <= MAX_UNLOCK_ATTEMPTS; attempt++) {
          try {
            const signed =
              attempt === 1 && cached && cached.expiresAt > Date.now()
                ? cached.payload
                : await signUnlock();

            // Always scanAndConnect (it verifies + reconnects a stale handle);
            // the cheap isConnected() null-check stays true for a dead link, so
            // gating on it made the unlock write hit a dropped connection and
            // fail. scanAndConnect returns fast when the link is genuinely live.
            await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
            // Arm the gate_opened confirmation BEFORE the write so a fast event
            // is never missed. A BLE write only ACKs that the ESP32 RECEIVED the
            // bytes — the firmware still silently no-ops (emitting nothing) on a
            // bad signature, a replayed ts, battery_critical, or a wrong gate
            // state. gate_opened is the only positive proof the solenoid fired;
            // without it we'd report success and start billing / hold the
            // deposit on a gate that never opened. The firmware echoes our
            // correlationId as the event's session_id (see emitGateOpened).
            const confirmed = awaitGateOpened(
              correlationId,
              (onEvent) => stationClient.subscribeToEvents(onEvent, () => {}),
              GATE_OPEN_CONFIRM_MS,
            );
            // Thread the station's BLE name so a mid-write reconnect can
            // re-target it by name (else the retry falls back to lastSeenDevice).
            await stationClient.unlock(signed, targetName);
            if (await confirmed) {
              return { ok: true, openedAt: Date.now() };
            }
            // Wrote but no gate_opened inside the window — a mid-write drop may
            // have swallowed the command or its event. Retry with a fresh sign.
            lastErr = new Error('unlock: gate_opened not received');
          } catch (e) {
            lastErr = e;
            // Drop the (likely dead) handle so the next attempt does a clean
            // scan+connect against the freshly re-advertising peripheral.
            try {
              await stationClient.disconnect();
            } catch {
              /* already gone — nothing to release */
            }
          }
          if (attempt < MAX_UNLOCK_ATTEMPTS) {
            // Brief pause to let the ESP32 finish re-advertising after a drop.
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        // Every attempt exhausted. A clean "wrote but no gate_opened" is a
        // timeout (release the hold, let the user retry); anything else
        // (connect/scan/write threw) rethrows into the catch below for the
        // connection_failed / out_of_range / bluetooth classification.
        if (
          lastErr instanceof Error &&
          lastErr.message === 'unlock: gate_opened not received'
        ) {
          reportError(lastErr, {
            source: 'ble.unlock.unconfirmed',
            stationId,
            gateId,
          });
          return { ok: false, error: 'timeout', message: 'gate_opened not received' };
        }
        throw lastErr;
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
        // Always scanAndConnect (verifies + reconnects a stale handle) — see the
        // unlock path above; gating on the cheap isConnected() operated on a
        // dead link and failed.
        await stationClient.scanAndConnect(targetName, SCAN_TIMEOUT_MS);
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
        // Persist the "return in progress" signal. This is what lets a
        // cold-launch reattach know there's a real gate_closed to catch — and,
        // conversely, keeps a plain active rental from reattaching (and wedging
        // the BLE radio) on every launch. Best-effort; never fail the return.
        try {
          useSessionStore.getState().markReturnInitiated();
        } catch {
          /* store access must not break the return write */
        }
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
      // Called on logout. Purge ALL module-global BLE state so nothing can leak
      // across accounts/sessions: a queued relay firing for the wrong user, a
      // stale ack cursor, a still-live cold-launch re-attach watch, or an
      // in-flight return recovery loop.
      clearReturnInFlight();
      // Cancel pending relay flush timers + drop buffered events so a debounced
      // relay can't POST after the user has signed out.
      clearAllRelayQueues();
      // Drop the per-station server ack cursor.
      lastAckedSeqByStation.clear();
      // Tear down the cold-launch re-attach watch (proximity + EVENTS sub).
      stopActiveStationReattach();
      // Drop stale nearby sightings so a freshly-signed-in account doesn't see
      // the prior user's last-known stations.
      try {
        useNearbyStore.getState().clear();
      } catch {
        // best-effort — never let store access block logout teardown.
      }
      stationClient.disconnect().catch(() => {});
    },
  };
}

/**
 * Cold-launch re-attach singleton. Holds the live proximity/EVENTS watch we
 * spun up for a recovered session so a second `reattachActiveStationWatch`
 * call (e.g. a Fast-Refresh re-run of the boot effect, or AppState churn) is a
 * no-op instead of opening a duplicate subscription against the same station.
 */
let reattachWatch: {
  stationId: string;
  sub: { stop: () => void };
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

/**
 * Hard cap on how long a cold-launch reattach watch may run. Its sole job is
 * to catch a `gate_closed` the firmware emits within seconds of the user
 * closing the door. If we haven't connected within this window the event isn't
 * arriving over BLE (server-side reconciliation handles it), and continuing to
 * scan just churns the radio and starves the single iOS scan. So we auto-stop.
 */
const REATTACH_MAX_MS = 3 * 60 * 1000;

/**
 * Re-establish the passive watch + EVENTS subscription for a still-active
 * persisted session on cold launch.
 *
 * Why this exists: the active session survives an app kill via zustand persist,
 * but a fresh launch does NOT re-open the BLE EVENTS subscription. Without it,
 * a `gate_closed` arriving after the user pushes the door shut would never be
 * received and the return could not auto-confirm. This re-runs the SAME wiring
 * a normal unlock relies on (`driver.watchStation`, which connects and calls
 * `stationClient.subscribeToEvents` → `dispatchStationEvent` → session store),
 * so an arriving event is handled exactly as it would be mid-session.
 *
 * Contract:
 *   - RESUBSCRIBE ONLY. Performs no writes, no return_unlock, no auto-confirm.
 *     It just makes the phone ready to *hear* an event; the existing return UI
 *     and `dispatchStationEvent` guards do the rest.
 *   - Idempotent. If a watch for this station is already live, it's a no-op.
 *     A watch for a *different* station is torn down first (the active session
 *     can only be one station).
 *   - Best-effort. Any failure is caught + reported; it must never crash launch.
 *
 * Pass the live driver (via `getDriver()`) so this honors the mock/ble toggle
 * and stays decoupled from the resolver (no circular import).
 *
 * @returns true if a watch was (or already is) established for the session.
 */
export function reattachActiveStationWatch(
  driver: Pick<HardwareDriver, 'watchStation'>,
  nowMs: number = Date.now(),
): boolean {
  try {
    const session = useSessionStore.getState().active;
    const decision = shouldReattach(session, nowMs);
    if (!decision.reattach) {
      // Nothing to resume. If a stale watch from a prior session is somehow
      // still live (e.g. the session ended in another tab), tear it down.
      stopActiveStationReattach();
      return false;
    }

    // Idempotent: a watch for this exact station already exists → no-op.
    if (reattachWatch?.stationId === decision.stationId) return true;

    // A watch for a different station is stale — replace it.
    if (reattachWatch) stopActiveStationReattach();

    // Same wiring as the play screen's `useStationInRange`: watchStation
    // connects and subscribes to EVENTS, routing notifications through
    // dispatchStationEvent into the session store. We don't care about the
    // ProximityState here — only the side-effect subscription — so the
    // onChange callback is a no-op.
    const sub = driver.watchStation(decision.stationId, () => {});
    // Bounded lifetime: the gate_closed for a real return lands within
    // seconds; if it doesn't, stop scanning rather than churn the radio.
    const timer = setTimeout(stopActiveStationReattach, REATTACH_MAX_MS);
    reattachWatch = { stationId: decision.stationId, sub, timer };
    return true;
  } catch (err) {
    // Best-effort: a re-attach failure must not crash launch.
    reportError(err as Error, { source: 'ble.reattach' });
    return false;
  }
}

/** Tear down any cold-launch re-attach watch. For tests + explicit teardown. */
export function stopActiveStationReattach(): void {
  if (!reattachWatch) return;
  if (reattachWatch.timer) {
    try {
      clearTimeout(reattachWatch.timer);
    } catch {
      /* ignore */
    }
  }
  try {
    reattachWatch.sub.stop();
  } catch {
    /* ignore */
  }
  reattachWatch = null;
}

export type { ProximityState };
