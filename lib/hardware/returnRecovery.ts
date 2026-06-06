/**
 * Pure decision logic for recovering a return when the BLE link drops
 * mid-return — after the phone sent `return_unlock` but before the
 * `gate_closed` event confirmed the door re-locked.
 *
 * ZERO React-Native / native imports so Jest imports it directly and the
 * branching is testable in isolation. The RN side (lib/hardware/ble.ts)
 * reconnects, re-reads station INFO, extracts the gate's state + session_id,
 * and feeds them here to decide the next move.
 *
 * Two invariants the rules protect:
 *   - NEVER falsely penalize: if our gate is re-locked, or has been taken
 *     over by a different session_id, our return is treated as DONE
 *     (`confirmed_closed`) — the renter is not left "unreturned" and is not
 *     charged a wrongful penalty.
 *   - NEVER silently strand: when genuinely ambiguous (our gate is still
 *     open / never closed / unreadable) AND we've exhausted reconnect
 *     attempts, fall back to the manual "kapattım" path (`manual_fallback`)
 *     rather than guessing.
 */

export type GateState =
  | 'LOCKED'
  | 'UNLOCKED'
  | 'IN_USE'
  | 'RETURN_UNLOCKED'
  | 'UNKNOWN';

export type ReturnRecoveryDecision =
  | 'confirmed_closed'
  | 'retry_return'
  | 'keep_waiting'
  | 'manual_fallback';

export interface ReturnRecoveryInput {
  /** Did we already receive a (signed/local) gate_closed for THIS session? */
  gotGateClosedEvent: boolean;
  /** The gate's current state from a fresh readInfo() for THIS session's gate. */
  infoGateState: GateState;
  /** session_id INFO reports for that gate (null/empty if firmware cleared it). */
  infoSessionId?: string | null;
  /** The active session's bleSessionId we expect to own the gate. */
  expectedSessionId: string;
  /** Reconnect/readInfo attempts left (<=0 means we're out of attempts). */
  attemptsRemaining: number;
}

/**
 * Decide what the recovery loop should do next.
 *
 * Decision table (first match wins):
 *
 *   gotGateClosedEvent === true
 *       → confirmed_closed
 *         (a real gate_closed already landed; nothing else can override it.)
 *
 *   infoGateState === 'LOCKED' AND (sessionId empty OR === expected)
 *       → confirmed_closed
 *         (gate physically closed and re-locked for us; the session is done.)
 *
 *   sessionId is present AND !== expected  ("someone else has the gate")
 *       → confirmed_closed
 *         (our gate is no longer ours — it's been re-claimed/served to
 *          another renter. Our return must have completed for that to happen,
 *          so treat it as done and NEVER penalize. This also covers the
 *          LOCKED-for-someone-else case.)
 *
 *   infoGateState === 'RETURN_UNLOCKED' AND sessionId === expected
 *       → still open for us: retry_return (attempts>0) else manual_fallback
 *
 *   infoGateState === 'IN_USE' AND sessionId === expected
 *       → the return never took: retry_return (attempts>0) else manual_fallback
 *
 *   infoGateState === 'UNLOCKED' AND sessionId === expected
 *       → ambiguous (not part of the return path): retry_return (attempts>0)
 *         else manual_fallback
 *
 *   infoGateState === 'UNKNOWN'  (couldn't read INFO)
 *       → keep_waiting (attempts>0) else manual_fallback
 *
 *   anything else genuinely ambiguous & out of attempts
 *       → manual_fallback
 */
export function interpretReturnRecovery(
  input: ReturnRecoveryInput,
): ReturnRecoveryDecision {
  const {
    gotGateClosedEvent,
    infoGateState,
    infoSessionId,
    expectedSessionId,
    attemptsRemaining,
  } = input;

  // 1. A real gate_closed event always wins. Don't double-confirm, don't
  //    second-guess it with a possibly-stale INFO read.
  if (gotGateClosedEvent) return 'confirmed_closed';

  const hasAttempts = attemptsRemaining > 0;
  const sessionEmpty = infoSessionId == null || infoSessionId === '';
  const sessionMatches = !sessionEmpty && infoSessionId === expectedSessionId;
  const sessionIsSomeoneElse = !sessionEmpty && infoSessionId !== expectedSessionId;

  // 2. Re-locked for us (or with a cleared session_id) → the door physically
  //    closed and the gate returned to LOCKED. The session is complete.
  if (infoGateState === 'LOCKED' && (sessionEmpty || sessionMatches)) {
    return 'confirmed_closed';
  }

  // 3. "Someone else has the gate." The gate now reports a DIFFERENT
  //    session_id (in any state, including LOCKED-for-them). Our gate is no
  //    longer ours: the firmware only re-claims a gate once the prior session
  //    finished, so our return is done. NEVER penalize.
  if (sessionIsSomeoneElse) {
    return 'confirmed_closed';
  }

  // From here the gate is still associated with OUR session (or has an
  // empty session_id in a non-LOCKED state, which we treat conservatively).
  switch (infoGateState) {
    // 4. Still physically open for our return — resend return_unlock if we
    //    can, otherwise hand off to the manual path.
    case 'RETURN_UNLOCKED':
      return hasAttempts ? 'retry_return' : 'manual_fallback';

    // 5. Back to IN_USE — the return write never took (e.g. dropped before
    //    the firmware processed it). Resend, or fall back.
    case 'IN_USE':
      return hasAttempts ? 'retry_return' : 'manual_fallback';

    // 6. UNLOCKED is not a normal return-path state for our session; treat it
    //    like an unfinished return — retry while we can, else manual.
    case 'UNLOCKED':
      return hasAttempts ? 'retry_return' : 'manual_fallback';

    // 7. Couldn't read the gate state. Give the link another chance, then
    //    hand off rather than guess.
    case 'UNKNOWN':
      return hasAttempts ? 'keep_waiting' : 'manual_fallback';

    // 8. LOCKED but with a non-matching/empty edge already handled above; any
    //    residual ambiguity is conservative manual fallback.
    default:
      return 'manual_fallback';
  }
}
