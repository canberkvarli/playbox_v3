// Jest tests for the PURE orphan-hold predicate. Imports the Deno-free module
// directly (same pattern as abandoned.test.ts / canonical-parity.test.ts).
import { shouldReleaseOrphanHold } from '../../supabase/functions/session-hold-sweep/orphan';

const NOW = 1_700_000_000_000;
const TTL = 120 * 60 * 1000; // 120 minutes

const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('shouldReleaseOrphanHold', () => {
  it('releases a held hold older than the TTL', () => {
    expect(shouldReleaseOrphanHold({ state: 'held', created_at: at(TTL + 1000) }, NOW, TTL)).toBe(true);
  });

  it('does NOT release a held hold still inside the TTL', () => {
    expect(shouldReleaseOrphanHold({ state: 'held', created_at: at(TTL - 1000) }, NOW, TTL)).toBe(false);
  });

  it('does NOT release a hold exactly at the TTL boundary (strictly greater)', () => {
    expect(shouldReleaseOrphanHold({ state: 'held', created_at: at(TTL) }, NOW, TTL)).toBe(false);
  });

  it('never touches an already-terminal hold', () => {
    expect(shouldReleaseOrphanHold({ state: 'captured', created_at: at(TTL + 1000) }, NOW, TTL)).toBe(false);
    expect(shouldReleaseOrphanHold({ state: 'released', created_at: at(TTL + 1000) }, NOW, TTL)).toBe(false);
  });

  it('is total: null or garbage created_at => false', () => {
    expect(shouldReleaseOrphanHold({ state: 'held', created_at: null }, NOW, TTL)).toBe(false);
    expect(shouldReleaseOrphanHold({ state: 'held', created_at: 'not-a-date' }, NOW, TTL)).toBe(false);
  });
});
