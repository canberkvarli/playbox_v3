import { planGossipDrain, buildAckCommand, coalesceRelayQueue } from './gossip';

const sig = (n: number) => `sig${n}`;

function ev(seq: number, extra: Record<string, unknown> = {}) {
  return { event: 'gate_closed', gate: 1, session_id: 's1', ts: 100 + seq, seq, sig: sig(seq), ...extra };
}

describe('planGossipDrain', () => {
  it('returns [] for an empty buffer (caller no-ops)', () => {
    expect(planGossipDrain([], null)).toEqual([]);
    expect(planGossipDrain([], 5)).toEqual([]);
  });

  it('filters out unsigned events (no sig/seq)', () => {
    const buf = [
      { event: 'gate_closed', gate: 1, session_id: 's1', ts: 1 }, // unsigned (no sig/seq)
      ev(3),
    ];
    expect(planGossipDrain(buf, null).map((e) => e.seq)).toEqual([3]);
  });

  it('drops events with seq <= lastAckedSeq', () => {
    const buf = [ev(1), ev(2), ev(3), ev(4)];
    expect(planGossipDrain(buf, 2).map((e) => e.seq)).toEqual([3, 4]);
  });

  it('includes all signed events when lastAckedSeq is null', () => {
    const buf = [ev(5), ev(1), ev(3)];
    expect(planGossipDrain(buf, null).map((e) => e.seq)).toEqual([1, 3, 5]);
  });

  it('sorts ascending by seq', () => {
    const buf = [ev(9), ev(2), ev(7)];
    expect(planGossipDrain(buf, null).map((e) => e.seq)).toEqual([2, 7, 9]);
  });

  it('dedupes by seq (keeps one per seq)', () => {
    const buf = [ev(2), ev(2), ev(3)];
    expect(planGossipDrain(buf, null).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('returns [] when everything is already acked', () => {
    const buf = [ev(1), ev(2)];
    expect(planGossipDrain(buf, 5)).toEqual([]);
  });
});

describe('buildAckCommand', () => {
  it('builds an ack command for a finite acked_seq', () => {
    expect(buildAckCommand(7)).toEqual({ cmd: 'ack', seq: 7 });
    expect(buildAckCommand(0)).toEqual({ cmd: 'ack', seq: 0 });
  });

  it('returns null when there is nothing to ack (null)', () => {
    expect(buildAckCommand(null)).toBeNull();
  });

  it('returns null for a non-finite acked_seq', () => {
    expect(buildAckCommand(Number.NaN)).toBeNull();
    expect(buildAckCommand(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('coalesceRelayQueue', () => {
  it('dedupes by seq and sorts ascending', () => {
    const pending = [ev(3), ev(1), ev(3), ev(2)];
    expect(coalesceRelayQueue(pending).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('returns [] for an empty queue', () => {
    expect(coalesceRelayQueue([])).toEqual([]);
  });
});
