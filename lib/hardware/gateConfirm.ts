import type { StationEvent } from '@/lib/ble/protocol';

/** Minimal shape of a react-native-ble-plx Subscription — only `remove`. */
export type EventSub = { remove: () => void };

/** Subscribe to firmware events; returns a handle that can be torn down. */
export type SubscribeFn = (onEvent: (e: StationEvent) => void) => EventSub;

/**
 * How long to wait for the firmware's `gate_opened` after an unlock write before
 * giving up. The write itself already ACK'd (bytes received); the firmware emits
 * gate_opened immediately after pulsing the solenoid, so a few seconds is plenty
 * of slack for BLE notify latency. On the rejection path (bad sig / replay /
 * battery_critical / wrong state) NOTHING is emitted, so we wait the full window
 * then report failure.
 */
export const GATE_OPEN_CONFIRM_MS = 6_000;

/**
 * Resolve `true` when the firmware emits a `gate_opened` for `sessionId`, or
 * `false` if `timeoutMs` elapses first.
 *
 * WHY THIS EXISTS: a BLE write only confirms the ESP32 *received the bytes* — it
 * is NOT proof the gate opened. The firmware silently `return`s (emitting
 * nothing) on a bad signature, a replayed ts, battery_critical, or a wrong gate
 * state. `gate_opened` is the only positive signal the solenoid actually fired.
 * Treating the write ACK as success means billing / holding a deposit on a gate
 * that never opened.
 *
 * Callers MUST arm this BEFORE issuing the unlock write so a fast event is never
 * missed, then `await` the returned promise.
 *
 * FAIL-CLOSED: if we can't even subscribe, resolve `false`. Never report an open
 * we couldn't confirm — the caller releases the payment hold on `false`.
 */
export function awaitGateOpened(
  sessionId: string,
  subscribe: SubscribeFn,
  timeoutMs: number = GATE_OPEN_CONFIRM_MS,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    let sub: EventSub | null = null;

    const finish = (val: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sub?.remove();
      } catch {
        // subscription already torn down (e.g. link dropped) — ignore
      }
      resolve(val);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      sub = subscribe((e) => {
        if (
          e.event === 'gate_opened' &&
          'session_id' in e &&
          e.session_id === sessionId
        ) {
          finish(true);
        }
      });
    } catch {
      // Couldn't subscribe (not connected) — can't confirm, so fail closed.
      finish(false);
    }
  });
}
