// Pure, Deno-compatible re-implementation of `eventSigningPayload` from
// lib/ble/protocol.ts. Kept dependency-free so it can run in the Supabase
// functions (Deno) runtime.
//
// INVARIANT: this MUST stay byte-for-byte identical to
//   lib/ble/protocol.ts::eventSigningPayload
// and to the firmware C++ signing contract. The shared golden fixture
//   __fixtures__/event-signing-vectors.json
// is the parity guard: both the Node/Jest suite and the Deno test assert the
// canonical string + HMAC sig it pins, so any drift here fails CI.
//
// Empty slots are PRESENCE-based: a field renders as the stringified value when
// its key is present on the event, and as "" when absent (e.g. `boot` has no
// gate / session_id → `boot|||<seq>|<ts>|`). `extra` is integer millivolts for
// battery_low / battery_critical, "" otherwise.
export function eventSigningPayload(e: Record<string, unknown>): string {
  const gate = "gate" in e ? String(e.gate) : "";
  const session = "session_id" in e ? String(e.session_id) : "";
  const extra =
    e.event === "battery_low" || e.event === "battery_critical"
      ? (e.mv == null ? "" : String(e.mv))
      : "";
  return `${e.event}|${gate}|${session}|${e.seq}|${e.ts}|${extra}`;
}
