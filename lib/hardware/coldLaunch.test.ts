import { shouldReattach, COLD_LAUNCH_MAX_AGE_MS } from './coldLaunch';

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

// Minimal builder mirroring the persisted ActiveSession shape. Only the fields
// shouldReattach cares about are required; extras are allowed but ignored.
function session(overrides: Record<string, unknown> = {}) {
  return {
    stationId: 'DEV-001',
    stationName: 'Playbox-DEV-001',
    sport: 'football',
    startedAt: NOW - 5 * 60_000, // 5 minutes ago — fresh
    durationMinutes: 30,
    gate: 2,
    bleSessionId: 'ble-sess-xyz',
    returnConfirmed: false,
    ...overrides,
  };
}

describe('shouldReattach', () => {
  it('re-attaches an active, recent session and returns the resume fields', () => {
    const r = shouldReattach(session(), NOW);
    expect(r).toEqual({
      reattach: true,
      stationId: 'DEV-001',
      stationName: 'Playbox-DEV-001',
      bleSessionId: 'ble-sess-xyz',
      gate: 2,
    });
  });

  it('does not re-attach when there is no session', () => {
    expect(shouldReattach(null, NOW)).toEqual({ reattach: false, reason: 'no_session' });
    expect(shouldReattach(undefined as never, NOW)).toEqual({
      reattach: false,
      reason: 'no_session',
    });
  });

  it('does not re-attach a session whose return is already confirmed', () => {
    expect(shouldReattach(session({ returnConfirmed: true }), NOW)).toEqual({
      reattach: false,
      reason: 'already_returned',
    });
  });

  it('does not re-attach a session older than the max age (stale)', () => {
    const old = session({ startedAt: NOW - (COLD_LAUNCH_MAX_AGE_MS + 60_000) });
    expect(shouldReattach(old, NOW)).toEqual({ reattach: false, reason: 'expired' });
  });

  it('re-attaches right at the max-age boundary (inclusive)', () => {
    const boundary = session({ startedAt: NOW - COLD_LAUNCH_MAX_AGE_MS });
    const r = shouldReattach(boundary, NOW);
    expect(r.reattach).toBe(true);
  });

  it('treats one ms past the boundary as expired', () => {
    const past = session({ startedAt: NOW - (COLD_LAUNCH_MAX_AGE_MS + 1) });
    expect(shouldReattach(past, NOW)).toEqual({ reattach: false, reason: 'expired' });
  });

  it('honors a caller-supplied maxAgeMs override', () => {
    const s = session({ startedAt: NOW - 2 * HOUR });
    expect(shouldReattach(s, NOW, { maxAgeMs: HOUR }).reattach).toBe(false);
    expect(shouldReattach(s, NOW, { maxAgeMs: 3 * HOUR }).reattach).toBe(true);
  });

  it('does not re-attach when bleSessionId is missing (cannot resume return)', () => {
    expect(shouldReattach(session({ bleSessionId: undefined }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
    expect(shouldReattach(session({ bleSessionId: '' }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
  });

  it('does not re-attach when stationName is missing', () => {
    expect(shouldReattach(session({ stationName: undefined }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
  });

  it('does not re-attach when stationId is missing', () => {
    expect(shouldReattach(session({ stationId: '' }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
  });

  it('does not re-attach when gate is missing (no gate to address)', () => {
    expect(shouldReattach(session({ gate: undefined }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
  });

  it('treats a non-finite startedAt as incomplete, not a crash', () => {
    expect(shouldReattach(session({ startedAt: undefined }), NOW)).toEqual({
      reattach: false,
      reason: 'incomplete',
    });
  });

  it('checks terminal-state before age so a confirmed-and-stale session reports already_returned', () => {
    const s = session({ returnConfirmed: true, startedAt: NOW - 999 * HOUR });
    expect(shouldReattach(s, NOW)).toEqual({ reattach: false, reason: 'already_returned' });
  });
});
