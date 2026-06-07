/**
 * Pure parsing of a station `readInfo()` JSON blob into a single gate's
 * (state, session_id). ZERO React-Native / native imports so Jest can import
 * and table-test it directly (lib/hardware/ble.ts pulls it back in).
 *
 * The firmware INFO shape is still evolving (today's PlayboxStation_3gate only
 * advertises station-level fields: station_id/fw/gates/battery_pct). So be
 * defensive and accept several plausible per-gate layouts, returning `UNKNOWN`
 * state when we genuinely can't tell. `gate` is 1-indexed (matches the
 * session's stored gate).
 *
 * Shapes tolerated:
 *   - { gate_states: ["LOCKED", "RETURN_UNLOCKED", ...],
 *       gate_sessions: ["", "sess-..", ...] }
 *   - { gates: [ { state, session_id }, ... ] }   (array of per-gate objects)
 *   - { gates: [ "LOCKED", ... ] }                (array of state strings)
 *   - { gate1: { state, session_id }, gate2: {...} }  (keyed objects)
 */

import type { GateState } from './returnRecovery';

const VALID_GATE_STATES: readonly GateState[] = [
  'LOCKED',
  'UNLOCKED',
  'IN_USE',
  'RETURN_UNLOCKED',
  'UNKNOWN',
];

/**
 * Pull the (state, session_id) for ONE gate out of a `readInfo()` JSON blob.
 * Returns `UNKNOWN` / null whenever the shape is unrecognized or the gate is
 * out of range — always safe to fall back on.
 */
export function extractGate(
  info: unknown,
  gate: number,
): { state: GateState; sessionId: string | null } {
  const unknown = { state: 'UNKNOWN' as GateState, sessionId: null };
  if (!info || typeof info !== 'object') return unknown;
  const obj = info as Record<string, unknown>;
  const idx = gate - 1; // 1-indexed gate → 0-indexed array slot

  const normState = (v: unknown): GateState =>
    typeof v === 'string' && (VALID_GATE_STATES as string[]).includes(v)
      ? (v as GateState)
      : 'UNKNOWN';
  const normSession = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;

  // (a) parallel arrays: gate_states[] / gate_sessions[]
  if (Array.isArray(obj.gate_states)) {
    const state = normState(obj.gate_states[idx]);
    const sessions = Array.isArray(obj.gate_sessions) ? obj.gate_sessions : [];
    return { state, sessionId: normSession(sessions[idx]) };
  }

  // (b) gates[] — array of per-gate objects OR plain state strings
  if (Array.isArray(obj.gates)) {
    const entry = obj.gates[idx];
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      return {
        state: normState(e.state ?? e.gate_state),
        sessionId: normSession(e.session_id ?? e.sessionId),
      };
    }
    if (typeof entry === 'string') {
      return { state: normState(entry), sessionId: null };
    }
    // `gates` is a number (count) in the current firmware — no per-gate data.
    return unknown;
  }

  // (c) keyed object: { gate1: {...}, gate2: {...} } or { "1": {...} }
  const keyed = (obj[`gate${gate}`] ?? obj[String(gate)]) as unknown;
  if (keyed && typeof keyed === 'object') {
    const e = keyed as Record<string, unknown>;
    return {
      state: normState(e.state ?? e.gate_state),
      sessionId: normSession(e.session_id ?? e.sessionId),
    };
  }

  return unknown;
}
