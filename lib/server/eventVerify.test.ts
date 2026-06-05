import { createHmac } from "node:crypto";
import { verifyEventSig, isDuplicate } from "./eventVerify";
import { eventSigningPayload } from "../ble/protocol";

// Fixed 64-hex (32-byte) station secret. The HMAC key is the hex-DECODED raw
// bytes — matching firmware + supabase/functions/_shared/blesign.ts. Keying the
// HMAC with the utf8 hex string would NOT match and every verify would fail.
const SECRET_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const WRONG_SECRET_HEX = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
function sign(e: any, secretHex: string = SECRET_HEX) {
  const { sig, ...rest } = e;
  const full = { ...rest, sig: "" };
  return {
    ...rest,
    sig: createHmac("sha256", Buffer.from(secretHex, "hex"))
      .update(eventSigningPayload(full))
      .digest("hex"),
  };
}

it("accepts a correctly signed event", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig(e, SECRET_HEX)).toBe(true);
});

it("rejects a tampered event (gate changed after signing)", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig({ ...e, gate: 2 }, SECRET_HEX)).toBe(false);
});

it("rejects an event signed with a different secret", () => {
  const e = sign({ event: "boot", seq: 1, ts: 50, sig: "" });
  expect(verifyEventSig(e, WRONG_SECRET_HEX)).toBe(false);
});

it("rejects a malformed (non-hex/garbage) sig without throwing", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig({ ...e, sig: "not-hex-zzz" }, SECRET_HEX)).toBe(false);
  expect(verifyEventSig({ ...e, sig: "" }, SECRET_HEX)).toBe(false);
  expect(verifyEventSig({ ...e, sig: "abc" }, SECRET_HEX)).toBe(false); // odd-length
});

it("returns false (no throw) when sig is non-string (adversarial wire JSON)", () => {
  const e = sign({ event: "boot", seq: 1, ts: 50, sig: "" });
  expect(verifyEventSig({ ...e, sig: undefined as any }, SECRET_HEX)).toBe(false);
  expect(verifyEventSig({ ...e, sig: 12345 as any }, SECRET_HEX)).toBe(false);
});

it("dedupes by (station_id, seq)", () => {
  const seen = new Set<string>();
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(false); // first time
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(true);  // replay
  expect(isDuplicate(seen, "DEV-002", 2)).toBe(false); // different station
});
