import { interpretReturnRecovery } from './returnRecovery';

const SID = 'sess-abc-123';

// Convenience builder with sane defaults for the "waiting for gate_closed"
// recovery scenario. Override per-test.
function input(overrides: Partial<Parameters<typeof interpretReturnRecovery>[0]> = {}) {
  return {
    gotGateClosedEvent: false,
    infoGateState: 'UNKNOWN' as const,
    infoSessionId: SID,
    expectedSessionId: SID,
    attemptsRemaining: 3,
    ...overrides,
  };
}

describe('interpretReturnRecovery', () => {
  describe('gate_closed event already received', () => {
    it('returns confirmed_closed regardless of everything else', () => {
      expect(
        interpretReturnRecovery(
          input({
            gotGateClosedEvent: true,
            infoGateState: 'RETURN_UNLOCKED', // still open per INFO, but the event wins
            attemptsRemaining: 0,
          }),
        ),
      ).toBe('confirmed_closed');
    });

    it('event wins even when the gate belongs to another session', () => {
      expect(
        interpretReturnRecovery(
          input({ gotGateClosedEvent: true, infoSessionId: 'someone-else' }),
        ),
      ).toBe('confirmed_closed');
    });
  });

  describe('gate is LOCKED → physically closed and re-locked', () => {
    it('confirmed_closed when session_id matches', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'LOCKED', infoSessionId: SID })),
      ).toBe('confirmed_closed');
    });

    it('confirmed_closed when session_id is null (firmware cleared it on re-lock)', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'LOCKED', infoSessionId: null })),
      ).toBe('confirmed_closed');
    });

    it('confirmed_closed when session_id is empty string', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'LOCKED', infoSessionId: '' })),
      ).toBe('confirmed_closed');
    });

    it('confirmed_closed (no penalty) when LOCKED for a DIFFERENT session', () => {
      // Our gate has already been re-locked AND re-claimed by another renter.
      // Our return is unambiguously done — never penalize.
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'LOCKED', infoSessionId: 'other-renter' }),
        ),
      ).toBe('confirmed_closed');
    });
  });

  describe('gate is RETURN_UNLOCKED → still open for our session', () => {
    it('retry_return when our session and attempts remain', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: SID, attemptsRemaining: 2 }),
        ),
      ).toBe('retry_return');
    });

    it('manual_fallback when our session but no attempts left', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: SID, attemptsRemaining: 0 }),
        ),
      ).toBe('manual_fallback');
    });

    it('confirmed_closed (no penalty) when RETURN_UNLOCKED belongs to a DIFFERENT session', () => {
      // The gate is open, but for someone else's session_id — ours is no
      // longer the active occupant of this gate, so our return is done.
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: 'other-renter' }),
        ),
      ).toBe('confirmed_closed');
    });
  });

  describe('gate is IN_USE → the return never took', () => {
    it('retry_return when our session and attempts remain', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'IN_USE', infoSessionId: SID, attemptsRemaining: 1 }),
        ),
      ).toBe('retry_return');
    });

    it('manual_fallback when our session but no attempts left', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'IN_USE', infoSessionId: SID, attemptsRemaining: 0 }),
        ),
      ).toBe('manual_fallback');
    });

    it('confirmed_closed (no penalty) when IN_USE belongs to a DIFFERENT session', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'IN_USE', infoSessionId: 'other-renter' }),
        ),
      ).toBe('confirmed_closed');
    });
  });

  describe('gate state UNKNOWN → could not read INFO', () => {
    it('keep_waiting while attempts remain', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'UNKNOWN', attemptsRemaining: 3 })),
      ).toBe('keep_waiting');
    });

    it('manual_fallback once out of attempts (never silently strand)', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'UNKNOWN', attemptsRemaining: 0 })),
      ).toBe('manual_fallback');
    });
  });

  describe('gate is UNLOCKED (unexpected initial-unlock state) for our session', () => {
    // UNLOCKED for our session is ambiguous (not part of the normal return
    // path). Be conservative: retry while attempts remain, else manual.
    it('retry_return when our session and attempts remain', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'UNLOCKED', infoSessionId: SID, attemptsRemaining: 2 }),
        ),
      ).toBe('retry_return');
    });

    it('manual_fallback when our session and no attempts', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'UNLOCKED', infoSessionId: SID, attemptsRemaining: 0 }),
        ),
      ).toBe('manual_fallback');
    });

    it('confirmed_closed when UNLOCKED for a different session', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'UNLOCKED', infoSessionId: 'other-renter' }),
        ),
      ).toBe('confirmed_closed');
    });
  });

  describe('attemptsRemaining boundary', () => {
    it('retry at exactly 1 attempt', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: SID, attemptsRemaining: 1 }),
        ),
      ).toBe('retry_return');
    });

    it('manual at exactly 0 attempts', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: SID, attemptsRemaining: 0 }),
        ),
      ).toBe('manual_fallback');
    });

    it('keep_waiting (UNKNOWN) at exactly 1 attempt', () => {
      expect(
        interpretReturnRecovery(input({ infoGateState: 'UNKNOWN', attemptsRemaining: 1 })),
      ).toBe('keep_waiting');
    });

    it('treats negative attemptsRemaining like 0', () => {
      expect(
        interpretReturnRecovery(
          input({ infoGateState: 'RETURN_UNLOCKED', infoSessionId: SID, attemptsRemaining: -1 }),
        ),
      ).toBe('manual_fallback');
    });
  });

  describe('never-penalize invariant: different session_id always confirms', () => {
    it.each(['LOCKED', 'UNLOCKED', 'IN_USE', 'RETURN_UNLOCKED'] as const)(
      '%s + different session → confirmed_closed (no wrongful penalty)',
      (state) => {
        expect(
          interpretReturnRecovery(
            input({ infoGateState: state, infoSessionId: 'definitely-not-ours', attemptsRemaining: 0 }),
          ),
        ).toBe('confirmed_closed');
      },
    );
  });

  describe('never-strand invariant: ambiguous + no attempts → manual_fallback', () => {
    it.each(['UNLOCKED', 'IN_USE', 'RETURN_UNLOCKED', 'UNKNOWN'] as const)(
      '%s (our session) + 0 attempts → manual_fallback (never silently unreturned)',
      (state) => {
        expect(
          interpretReturnRecovery(
            input({ infoGateState: state, infoSessionId: SID, attemptsRemaining: 0 }),
          ),
        ).toBe('manual_fallback');
      },
    );
  });
});
