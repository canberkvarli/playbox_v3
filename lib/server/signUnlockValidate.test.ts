// Jest tests for the PURE sign-unlock param validator. Imports the Deno-free
// module directly (same pattern as abandoned.test.ts / orphanHold.test.ts).
import { validateUnlockParams } from '../../supabase/functions/sign-unlock/validate';

const OK = { session_id: 'unlock-DEV-001-football-1', gate: 1, duration_min: 30 };

describe('validateUnlockParams', () => {
  it('accepts valid params', () => {
    expect(validateUnlockParams(OK)).toEqual({ ok: true });
  });

  describe('session_id (pipe-injection guard)', () => {
    it('rejects a pipe — the HMAC delimiter', () => {
      expect(validateUnlockParams({ ...OK, session_id: 'a|b' })).toEqual({
        ok: false,
        error: 'bad_session_id',
      });
    });
    it('rejects other delimiters / whitespace / empty / too-long / non-string', () => {
      const bad = ['a b', 'a/b', 'a:b', 'a.b', '', 'x'.repeat(129), 123, null, undefined];
      for (const s of bad) {
        expect(validateUnlockParams({ ...OK, session_id: s }).ok).toBe(false);
      }
    });
    it('accepts alphanumerics + hyphens up to 128 chars', () => {
      expect(validateUnlockParams({ ...OK, session_id: 'A-z0-9' }).ok).toBe(true);
      expect(validateUnlockParams({ ...OK, session_id: 'x'.repeat(128) }).ok).toBe(true);
    });
  });

  describe('gate bounds', () => {
    it('rejects <1, >16, non-integer, non-number', () => {
      for (const g of [0, -1, 17, 1.5, NaN, '1', undefined]) {
        expect(validateUnlockParams({ ...OK, gate: g }).ok).toBe(false);
      }
    });
    it('accepts 1..16', () => {
      expect(validateUnlockParams({ ...OK, gate: 1 }).ok).toBe(true);
      expect(validateUnlockParams({ ...OK, gate: 16 }).ok).toBe(true);
    });
  });

  describe('duration bounds', () => {
    it('rejects <1, >600, non-integer', () => {
      for (const d of [0, -5, 601, 30.5, NaN, '30']) {
        expect(validateUnlockParams({ ...OK, duration_min: d }).ok).toBe(false);
      }
    });
    it('accepts 1..600', () => {
      expect(validateUnlockParams({ ...OK, duration_min: 1 }).ok).toBe(true);
      expect(validateUnlockParams({ ...OK, duration_min: 600 }).ok).toBe(true);
    });
  });
});
