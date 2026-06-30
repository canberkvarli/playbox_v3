// PURE, Deno-free validation for sign-unlock params. Jest-importable directly
// (same pattern as session-sweep/abandoned.ts).
//
// SECURITY: the BLE HMAC signing string is pipe-delimited
//   `${cmd}|${gate}|${session_id}|${duration_min}|${ts}`
// so a session_id containing `|` could forge a signature ALSO valid for a
// different (gate, duration). session_id is therefore restricted to the firmware
// charset, and gate + duration are bounded to sane integers, BEFORE signing.

export type UnlockParamCheck = { ok: true } | { ok: false; error: string };

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,128}$/;

// Server-side sanity ceiling for the physical gate; the firmware re-checks
// against its own NUM_GATES.
const MAX_GATE = 16;
const MAX_DURATION_MIN = 600;

export function validateUnlockParams(p: {
  session_id: unknown;
  gate: unknown;
  duration_min: unknown;
}): UnlockParamCheck {
  if (typeof p.session_id !== 'string' || !SESSION_ID_RE.test(p.session_id)) {
    return { ok: false, error: 'bad_session_id' };
  }
  if (
    typeof p.gate !== 'number' ||
    !Number.isInteger(p.gate) ||
    p.gate < 1 ||
    p.gate > MAX_GATE
  ) {
    return { ok: false, error: 'bad_gate' };
  }
  if (
    typeof p.duration_min !== 'number' ||
    !Number.isInteger(p.duration_min) ||
    p.duration_min < 1 ||
    p.duration_min > MAX_DURATION_MIN
  ) {
    return { ok: false, error: 'bad_duration' };
  }
  return { ok: true };
}
