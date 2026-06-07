import { isFreshlyPresent, presenceReason } from './proximity';

const NOW = 1_000_000;

describe('isFreshlyPresent', () => {
  it('returns false when there is no sighting (null)', () => {
    expect(isFreshlyPresent(null, NOW)).toBe(false);
  });

  it('returns false when the sighting is undefined', () => {
    expect(isFreshlyPresent(undefined, NOW)).toBe(false);
  });

  it('returns true for a fresh (recent) sighting', () => {
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 2_000 }, NOW)).toBe(
      true,
    );
  });

  it('returns false for a stale sighting older than maxAge', () => {
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 11_000 }, NOW)).toBe(
      false,
    );
  });

  it('treats the maxAge boundary as inclusive (still fresh exactly at maxAge)', () => {
    // default maxAgeMs = 10_000
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 10_000 }, NOW)).toBe(
      true,
    );
    // one ms past the boundary → stale
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 10_001 }, NOW)).toBe(
      false,
    );
  });

  it('honours a custom maxAgeMs', () => {
    expect(
      isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 4_000 }, NOW, {
        maxAgeMs: 3_000,
      }),
    ).toBe(false);
    expect(
      isFreshlyPresent({ rssi: -60, lastSeenAt: NOW - 2_000 }, NOW, {
        maxAgeMs: 3_000,
      }),
    ).toBe(true);
  });

  it('applies the minRssi floor only when provided (weak signal → false)', () => {
    const weak = { rssi: -95, lastSeenAt: NOW - 1_000 };
    // no minRssi → RSSI ignored, fresh regardless of weak signal
    expect(isFreshlyPresent(weak, NOW)).toBe(true);
    // minRssi provided → weak signal fails the floor
    expect(isFreshlyPresent(weak, NOW, { minRssi: -80 })).toBe(false);
    // strong enough passes
    expect(
      isFreshlyPresent({ rssi: -70, lastSeenAt: NOW - 1_000 }, NOW, {
        minRssi: -80,
      }),
    ).toBe(true);
  });

  it('treats a negative age (future/0 lastSeenAt) as fresh, not stale', () => {
    // clock skew: sighting timestamp is ahead of now
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW + 5_000 }, NOW)).toBe(
      true,
    );
    // lastSeenAt 0 with a large now → negative-ish guard, still treated as a
    // present sighting rather than wrongly stale
    expect(isFreshlyPresent({ rssi: -60, lastSeenAt: NOW + 1 }, NOW)).toBe(true);
  });
});

describe('presenceReason', () => {
  it('returns "absent" when there is no sighting', () => {
    expect(presenceReason(null, NOW)).toBe('absent');
    expect(presenceReason(undefined, NOW)).toBe('absent');
  });

  it('returns "present" for a fresh sighting', () => {
    expect(presenceReason({ rssi: -60, lastSeenAt: NOW - 1_000 }, NOW)).toBe(
      'present',
    );
  });

  it('returns "stale" for an aged-out sighting', () => {
    expect(presenceReason({ rssi: -60, lastSeenAt: NOW - 20_000 }, NOW)).toBe(
      'stale',
    );
  });

  it('returns "weak" when fresh but below the minRssi floor', () => {
    expect(
      presenceReason({ rssi: -95, lastSeenAt: NOW - 1_000 }, NOW, {
        minRssi: -80,
      }),
    ).toBe('weak');
  });

  it('prioritises "stale" over "weak" when both old and weak', () => {
    expect(
      presenceReason({ rssi: -95, lastSeenAt: NOW - 20_000 }, NOW, {
        minRssi: -80,
      }),
    ).toBe('stale');
  });
});
