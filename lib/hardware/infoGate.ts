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

/** Physical door position for one gate, straight off the reed switch. */
export type DoorState = 'closed' | 'open' | 'unknown';

/**
 * Pull the physical DOOR state for ONE gate out of a `readInfo()` blob.
 *
 * Source of truth is `info.states[]` (firmware `refreshInfoChar()`), where each
 * entry carries `door: "closed" | "open" | "unknown"` derived from the reed.
 * `"unknown"` is what a gate with no reed soldered on reports — it is NOT the
 * same as `"open"`, and callers must treat it permissively (allow the action)
 * rather than as a closed door they can act on or an open one they can't.
 *
 * Falls back to `info.reed`, the raw per-gate level string ('0' closed,
 * '1' open, '-' unwired), so a firmware that only emits the compact form still
 * answers. Anything unrecognized → 'unknown'.
 */
export function extractDoor(info: unknown, gate: number): DoorState {
  if (!info || typeof info !== 'object') return 'unknown';
  const obj = info as Record<string, unknown>;
  const idx = gate - 1;
  if (idx < 0) return 'unknown';

  if (Array.isArray(obj.states)) {
    const entry = obj.states[idx];
    if (entry && typeof entry === 'object') {
      const door = (entry as Record<string, unknown>).door;
      if (door === 'closed' || door === 'open') return door;
    }
  }

  if (typeof obj.reed === 'string') {
    const c = obj.reed[idx];
    if (c === '0') return 'closed';
    if (c === '1') return 'open';
  }

  return 'unknown';
}
