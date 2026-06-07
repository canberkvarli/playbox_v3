import {
  isSignedEvent,
  buildIngestBatch,
  pickAckedSeq,
} from './relay';

// A minimal signed (Phase 0 shape) event: carries `event`, `seq`, `sig`.
const signed = (over: Record<string, unknown> = {}) => ({
  event: 'gate_closed',
  gate: 1,
  session_id: 'abc',
  seq: 7,
  ts: 1_700_000_000,
  sig: 'deadbeef',
  ...over,
});

describe('isSignedEvent', () => {
  it('true for a fully signed event (sig string + finite seq + event string)', () => {
    expect(isSignedEvent(signed())).toBe(true);
  });

  it('false when sig is missing', () => {
    const { sig, ...noSig } = signed();
    expect(isSignedEvent(noSig)).toBe(false);
  });

  it('false when sig is an empty string', () => {
    expect(isSignedEvent(signed({ sig: '' }))).toBe(false);
  });

  it('false when sig is not a string', () => {
    expect(isSignedEvent(signed({ sig: 123 }))).toBe(false);
  });

  it('false when seq is missing', () => {
    const { seq, ...noSeq } = signed();
    expect(isSignedEvent(noSeq)).toBe(false);
  });

  it('false when seq is non-numeric', () => {
    expect(isSignedEvent(signed({ seq: '7' }))).toBe(false);
  });

  it('false when seq is not finite (NaN)', () => {
    expect(isSignedEvent(signed({ seq: Number.NaN }))).toBe(false);
  });

  it('false when event is missing (unsigned/today firmware shape)', () => {
    const { event, ...noEvent } = signed();
    expect(isSignedEvent(noEvent)).toBe(false);
  });

  it('false for null / non-object', () => {
    expect(isSignedEvent(null)).toBe(false);
    expect(isSignedEvent(undefined)).toBe(false);
    expect(isSignedEvent('gate_closed')).toBe(false);
    expect(isSignedEvent(42)).toBe(false);
  });

  it("false for today's UNSIGNED firmware event (no sig, no seq)", () => {
    expect(isSignedEvent({ event: 'gate_closed', gate: 1, session_id: 'abc' })).toBe(false);
  });
});

describe('buildIngestBatch', () => {
  it('returns null when there are no events', () => {
    expect(buildIngestBatch('DEV-001', [])).toBeNull();
  });

  it('returns null when NO events are signed (todays unsigned firmware → no-op)', () => {
    const unsigned = [
      { event: 'gate_closed', gate: 1, session_id: 'abc' },
      { event: 'boot' },
    ];
    expect(buildIngestBatch('DEV-001', unsigned)).toBeNull();
  });

  it('filters out unsigned events, keeping only signed ones', () => {
    const batch = buildIngestBatch('DEV-001', [
      { event: 'gate_closed', gate: 1, session_id: 'abc' }, // unsigned
      signed({ seq: 5 }),
      { event: 'boot' }, // unsigned
      signed({ seq: 6 }),
    ]);
    expect(batch).not.toBeNull();
    expect(batch!.events).toHaveLength(2);
    expect(batch!.events.map((e) => e.seq)).toEqual([5, 6]);
  });

  it('preserves order of signed events', () => {
    const batch = buildIngestBatch('S1', [
      signed({ seq: 9 }),
      signed({ seq: 2 }),
      signed({ seq: 5 }),
    ]);
    expect(batch!.events.map((e) => e.seq)).toEqual([9, 2, 5]);
  });

  it('sets station_id on the batch', () => {
    const batch = buildIngestBatch('STATION-XYZ', [signed()]);
    expect(batch!.station_id).toBe('STATION-XYZ');
  });
});

describe('pickAckedSeq', () => {
  it('extracts a finite acked_seq number', () => {
    expect(pickAckedSeq({ ok: true, acked_seq: 12 })).toBe(12);
  });

  it('extracts acked_seq of 0', () => {
    expect(pickAckedSeq({ ok: true, acked_seq: 0 })).toBe(0);
  });

  it('returns null when acked_seq is missing', () => {
    expect(pickAckedSeq({ ok: true, accepted: 1 })).toBeNull();
  });

  it('returns null when acked_seq is not a number', () => {
    expect(pickAckedSeq({ acked_seq: '12' })).toBeNull();
  });

  it('returns null when acked_seq is non-finite', () => {
    expect(pickAckedSeq({ acked_seq: Number.NaN })).toBeNull();
    expect(pickAckedSeq({ acked_seq: Infinity })).toBeNull();
  });

  it('returns null for null / non-object response', () => {
    expect(pickAckedSeq(null)).toBeNull();
    expect(pickAckedSeq(undefined)).toBeNull();
    expect(pickAckedSeq('ok')).toBeNull();
  });
});
