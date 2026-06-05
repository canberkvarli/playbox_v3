import { createHmac } from "node:crypto";
import { verifyEventSig, isDuplicate } from "./eventVerify";
import { eventSigningPayload } from "../ble/protocol";

const SECRET = "station-secret-DEV-001";
function sign(e: any) {
  const { sig, ...rest } = e;
  const full = { ...rest, sig: "" };
  return { ...rest, sig: createHmac("sha256", SECRET).update(eventSigningPayload(full)).digest("hex") };
}

it("accepts a correctly signed event", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig(e, SECRET)).toBe(true);
});

it("rejects a tampered event (gate changed after signing)", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig({ ...e, gate: 2 }, SECRET)).toBe(false);
});

it("rejects an event signed with a different secret", () => {
  const e = sign({ event: "boot", seq: 1, ts: 50, sig: "" });
  expect(verifyEventSig(e, "wrong-secret")).toBe(false);
});

it("rejects a malformed (non-hex/garbage) sig without throwing", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig({ ...e, sig: "not-hex-zzz" }, SECRET)).toBe(false);
  expect(verifyEventSig({ ...e, sig: "" }, SECRET)).toBe(false);
  expect(verifyEventSig({ ...e, sig: "abc" }, SECRET)).toBe(false); // odd-length
});

it("returns false (no throw) when sig is non-string (adversarial wire JSON)", () => {
  const e = sign({ event: "boot", seq: 1, ts: 50, sig: "" });
  expect(verifyEventSig({ ...e, sig: undefined as any }, SECRET)).toBe(false);
  expect(verifyEventSig({ ...e, sig: 12345 as any }, SECRET)).toBe(false);
});

it("dedupes by (station_id, seq)", () => {
  const seen = new Set<string>();
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(false); // first time
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(true);  // replay
  expect(isDuplicate(seen, "DEV-002", 2)).toBe(false); // different station
});
