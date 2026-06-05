// SERVER-ONLY. Imports node:crypto — never import from React Native / app code (would break the Metro bundle).
import { createHmac, timingSafeEqual } from "node:crypto";
import { eventSigningPayload, type StationEvent } from "../ble/protocol";

// Verify a station-signed event's HMAC against the per-station secret.
// Constant-time compare to avoid timing leaks. Returns false on any length/format mismatch.
export function verifyEventSig(e: StationEvent, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(eventSigningPayload(e)).digest("hex");
  let a: Buffer, b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(e.sig, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

// Courier delivery is at-least-once and may arrive out of order via different phones.
// Dedupe by (station_id, seq). Mutates `seen`; returns true if already seen.
export function isDuplicate(seen: Set<string>, stationId: string, seq: number): boolean {
  const key = `${stationId}:${seq}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
