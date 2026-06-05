// REAL anti-drift guard for the canonical signing string.
//
// Phase 1 Task 2 added a pure, dependency-free Deno re-impl of
// `eventSigningPayload` at supabase/functions/_shared/canonical.ts that MUST
// stay byte-for-byte identical to lib/ble/protocol.ts::eventSigningPayload.
//
// The golden-vector suite (eventVerify.vectors.test.ts) only exercises the Node
// impl, so silent drift in canonical.ts would NOT be caught there. canonical.ts
// is pure TS with no Deno-specific imports, so Jest (via babel-jest, jest-expo
// preset) CAN import it directly. This test imports BOTH impls and asserts they
// return the IDENTICAL string for every structurally-distinct canonical shape.
import { eventSigningPayload as nodeImpl, type StationEvent } from "../ble/protocol";
import { eventSigningPayload as denoImpl } from "../../supabase/functions/_shared/canonical";

// One event per structurally-distinct canonical shape:
//   • gate + session         → gate_closed / gate_opened
//   • session-only, no gate   → unlock_timeout / return_timeout / ball_overdue
//   • no gate, no session     → boot
//   • battery extra (mv)      → battery_low / battery_critical
const cases: { name: string; event: StationEvent }[] = [
  { name: "gate_closed (gate+session)", event: { event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "x" } },
  { name: "gate_opened (gate+session)", event: { event: "gate_opened", gate: 2, session_id: "s2", seq: 3, ts: 101, sig: "x" } },
  { name: "unlock_timeout (session, no gate)", event: { event: "unlock_timeout", session_id: "s1", seq: 5, ts: 250, sig: "x" } },
  { name: "return_timeout (session, no gate)", event: { event: "return_timeout", session_id: "s3", seq: 6, ts: 251, sig: "x" } },
  { name: "ball_overdue (session, no gate)", event: { event: "ball_overdue", session_id: "s4", seq: 7, ts: 252, sig: "x" } },
  { name: "boot (no gate, no session)", event: { event: "boot", seq: 1, ts: 50, sig: "x" } },
  { name: "battery_low (mv extra)", event: { event: "battery_low", mv: 11900, seq: 7, ts: 200, sig: "x" } },
  { name: "battery_critical (mv extra)", event: { event: "battery_critical", mv: 11500, seq: 9, ts: 300, sig: "x" } },
];

describe("canonical signing-string parity: Node impl === Deno impl", () => {
  for (const { name, event } of cases) {
    it(`identical canonical for ${name}`, () => {
      const node = nodeImpl(event);
      const deno = denoImpl(event as unknown as Record<string, unknown>);
      expect(deno).toBe(node);
    });
  }
});
