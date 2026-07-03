import { awaitGateOpened } from './gateConfirm';
import type { StationEvent } from '@/lib/ble/protocol';

/** Fake subscribe that lets a test push events and observe teardown. */
function makeSub() {
  let cb: ((e: StationEvent) => void) | null = null;
  let removed = false;
  return {
    subscribe: (onEvent: (e: StationEvent) => void) => {
      cb = onEvent;
      return { remove: () => { removed = true; } };
    },
    emit: (e: StationEvent) => cb?.(e),
    get removed() { return removed; },
  };
}

const gateOpened = (sid: string, gate = 1): StationEvent =>
  ({ event: 'gate_opened', gate, session_id: sid, seq: 1, ts: 1, sig: 'x' } as StationEvent);

describe('awaitGateOpened', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves true on a matching gate_opened and tears down the listener', async () => {
    const s = makeSub();
    const p = awaitGateOpened('sid-1', s.subscribe, 6000);
    s.emit(gateOpened('sid-1'));
    await expect(p).resolves.toBe(true);
    expect(s.removed).toBe(true);
  });

  it('ignores gate_opened for a different session, then times out', async () => {
    const s = makeSub();
    const p = awaitGateOpened('sid-1', s.subscribe, 6000);
    s.emit(gateOpened('someone-else'));
    jest.advanceTimersByTime(6000);
    await expect(p).resolves.toBe(false);
  });

  it('resolves false on timeout (firmware silently rejected the command)', async () => {
    const s = makeSub();
    const p = awaitGateOpened('sid-1', s.subscribe, 6000);
    jest.advanceTimersByTime(6000);
    await expect(p).resolves.toBe(false);
    expect(s.removed).toBe(true);
  });

  it('ignores non-gate_opened events for the same session', async () => {
    const s = makeSub();
    const p = awaitGateOpened('sid-1', s.subscribe, 6000);
    s.emit({ event: 'gate_closed', gate: 1, session_id: 'sid-1', seq: 1, ts: 1, sig: 'x' } as StationEvent);
    jest.advanceTimersByTime(6000);
    await expect(p).resolves.toBe(false);
  });

  it('fails closed when subscribe throws (not connected)', async () => {
    const p = awaitGateOpened('sid-1', () => { throw new Error('Not connected'); }, 6000);
    await expect(p).resolves.toBe(false);
  });
});
