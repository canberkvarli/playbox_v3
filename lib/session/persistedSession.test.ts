import {
  sanitizeActiveSession,
  sanitizeEndedSession,
  migratePersistedSession,
} from './persistedSession';

const validActive = {
  stationId: 'DEV-001',
  stationName: 'Workshop',
  sport: 'football',
  startedAt: 1_700_000_000_000,
  durationMinutes: 60,
};

describe('sanitizeActiveSession', () => {
  it('passes a well-formed session through', () => {
    expect(sanitizeActiveSession(validActive)).toEqual(validActive);
  });

  it('rejects non-objects', () => {
    expect(sanitizeActiveSession(null)).toBeNull();
    expect(sanitizeActiveSession('nope')).toBeNull();
    expect(sanitizeActiveSession(42)).toBeNull();
  });

  it('rejects when a required field is missing or wrong-typed', () => {
    expect(sanitizeActiveSession({ ...validActive, stationId: '' })).toBeNull();
    expect(sanitizeActiveSession({ ...validActive, stationName: 123 })).toBeNull();
    expect(sanitizeActiveSession({ ...validActive, sport: undefined })).toBeNull();
    expect(sanitizeActiveSession({ ...validActive, startedAt: 'soon' })).toBeNull();
    expect(sanitizeActiveSession({ ...validActive, startedAt: NaN })).toBeNull();
    expect(sanitizeActiveSession({ ...validActive, durationMinutes: 0 })).toBeNull();
  });

  it('carries valid optional fields through', () => {
    const out = sanitizeActiveSession({
      ...validActive,
      holdId: 'hold-1',
      gate: 2,
      bleSessionId: 'unlock:DEV-001:football:1',
      returnConfirmed: true,
      overdue: false,
    });
    expect(out).toMatchObject({
      holdId: 'hold-1',
      gate: 2,
      bleSessionId: 'unlock:DEV-001:football:1',
      returnConfirmed: true,
      overdue: false,
    });
  });

  it('drops malformed optionals but keeps the session', () => {
    const out = sanitizeActiveSession({
      ...validActive,
      gate: 'two', // bad
      returnConfirmed: 'yes', // bad
      bleSessionId: '', // bad (empty)
    });
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty('gate');
    expect(out).not.toHaveProperty('returnConfirmed');
    expect(out).not.toHaveProperty('bleSessionId');
  });

  it('accepts holdId of null (no card hold placed)', () => {
    const out = sanitizeActiveSession({ ...validActive, holdId: null });
    expect(out?.holdId).toBeNull();
  });
});

describe('sanitizeEndedSession', () => {
  it('requires a valid endedAt on top of the base shape', () => {
    expect(sanitizeEndedSession(validActive)).toBeNull(); // no endedAt
    const out = sanitizeEndedSession({ ...validActive, endedAt: 1_700_000_100_000 });
    expect(out).toMatchObject({ ...validActive, endedAt: 1_700_000_100_000 });
  });
});

describe('migratePersistedSession', () => {
  it('returns an empty shape for garbage input', () => {
    expect(migratePersistedSession(null)).toEqual({ active: null, lastEnded: null });
    expect(migratePersistedSession('corrupt')).toEqual({ active: null, lastEnded: null });
    expect(migratePersistedSession({})).toEqual({ active: null, lastEnded: null });
  });

  it('sanitizes both active and lastEnded independently', () => {
    const out = migratePersistedSession({
      active: validActive,
      lastEnded: { ...validActive, endedAt: 1_700_000_100_000 },
    });
    expect(out.active).toEqual(validActive);
    expect(out.lastEnded).toMatchObject({ endedAt: 1_700_000_100_000 });
  });

  it('drops a corrupt active but keeps a valid lastEnded', () => {
    const out = migratePersistedSession({
      active: { stationId: '', junk: true },
      lastEnded: { ...validActive, endedAt: 1_700_000_100_000 },
    });
    expect(out.active).toBeNull();
    expect(out.lastEnded).not.toBeNull();
  });
});
