import { extractGate } from './infoGate';
import type { GateState } from './returnRecovery';

const SID = 'sess-abc-123';

describe('extractGate', () => {
  describe('tolerated INFO layouts → expected { state, sessionId }', () => {
    type Case = {
      name: string;
      info: unknown;
      gate: number;
      expected: { state: GateState; sessionId: string | null };
    };

    const cases: Case[] = [
      // (a) parallel arrays: gate_states[] / gate_sessions[]
      {
        name: 'parallel arrays — gate 2 RETURN_UNLOCKED with session',
        info: {
          gate_states: ['LOCKED', 'RETURN_UNLOCKED', 'IN_USE'],
          gate_sessions: ['', SID, 'other'],
        },
        gate: 2,
        expected: { state: 'RETURN_UNLOCKED', sessionId: SID },
      },
      {
        name: 'parallel arrays — empty session string normalizes to null',
        info: {
          gate_states: ['LOCKED', 'RETURN_UNLOCKED'],
          gate_sessions: ['', ''],
        },
        gate: 1,
        expected: { state: 'LOCKED', sessionId: null },
      },
      {
        name: 'parallel arrays — gate_sessions missing entirely → null session',
        info: { gate_states: ['IN_USE'] },
        gate: 1,
        expected: { state: 'IN_USE', sessionId: null },
      },
      // (b) gates[] — array of per-gate objects
      {
        name: 'gates[] objects — state + session_id',
        info: {
          gates: [
            { state: 'LOCKED', session_id: '' },
            { state: 'IN_USE', session_id: SID },
          ],
        },
        gate: 2,
        expected: { state: 'IN_USE', sessionId: SID },
      },
      {
        name: 'gates[] objects — gate_state + sessionId aliases',
        info: { gates: [{ gate_state: 'UNLOCKED', sessionId: SID }] },
        gate: 1,
        expected: { state: 'UNLOCKED', sessionId: SID },
      },
      // (b') gates[] — array of plain state strings (no session data)
      {
        name: 'gates[] strings — state only, null session',
        info: { gates: ['LOCKED', 'RETURN_UNLOCKED'] },
        gate: 2,
        expected: { state: 'RETURN_UNLOCKED', sessionId: null },
      },
      // (c) keyed objects: { gate1: {...}, gate2: {...} }
      {
        name: 'keyed gateN objects',
        info: {
          gate1: { state: 'LOCKED', session_id: '' },
          gate2: { state: 'RETURN_UNLOCKED', session_id: SID },
        },
        gate: 2,
        expected: { state: 'RETURN_UNLOCKED', sessionId: SID },
      },
      {
        name: 'keyed numeric-string objects { "1": {...} }',
        info: { '1': { state: 'IN_USE', session_id: SID } },
        gate: 1,
        expected: { state: 'IN_USE', sessionId: SID },
      },
    ];

    it.each(cases)('$name', ({ info, gate, expected }) => {
      expect(extractGate(info, gate)).toEqual(expected);
    });
  });

  describe('safe UNKNOWN fallbacks for unrecognized / partial shapes', () => {
    it('count-only { gates: 3 } → UNKNOWN (no per-gate data)', () => {
      expect(extractGate({ gates: 3 }, 1)).toEqual({
        state: 'UNKNOWN',
        sessionId: null,
      });
    });

    it('station-level-only INFO (current firmware) → UNKNOWN', () => {
      expect(
        extractGate(
          { station_id: 'DEV-001', fw: '1.2.3', gates: 3, battery_pct: 88 },
          1,
        ),
      ).toEqual({ state: 'UNKNOWN', sessionId: null });
    });

    it('missing INFO (null) → UNKNOWN', () => {
      expect(extractGate(null, 1)).toEqual({ state: 'UNKNOWN', sessionId: null });
    });

    it('undefined INFO → UNKNOWN', () => {
      expect(extractGate(undefined, 1)).toEqual({
        state: 'UNKNOWN',
        sessionId: null,
      });
    });

    it('empty object → UNKNOWN', () => {
      expect(extractGate({}, 1)).toEqual({ state: 'UNKNOWN', sessionId: null });
    });

    it('non-object INFO (string) → UNKNOWN', () => {
      expect(extractGate('LOCKED', 1)).toEqual({
        state: 'UNKNOWN',
        sessionId: null,
      });
    });

    it('gate index out of range (parallel arrays) → UNKNOWN', () => {
      expect(
        extractGate({ gate_states: ['LOCKED'], gate_sessions: [SID] }, 5),
      ).toEqual({ state: 'UNKNOWN', sessionId: null });
    });

    it('gate index out of range (gates[] objects) → UNKNOWN', () => {
      expect(
        extractGate({ gates: [{ state: 'LOCKED', session_id: SID }] }, 9),
      ).toEqual({ state: 'UNKNOWN', sessionId: null });
    });

    it('unrecognized state string normalizes to UNKNOWN', () => {
      expect(extractGate({ gate_states: ['BOGUS'] }, 1)).toEqual({
        state: 'UNKNOWN',
        sessionId: null,
      });
    });

    it('keyed object missing the requested gate → UNKNOWN', () => {
      expect(
        extractGate({ gate1: { state: 'LOCKED', session_id: SID } }, 2),
      ).toEqual({ state: 'UNKNOWN', sessionId: null });
    });
  });
});
