// SERVER-ONLY. Imports node:crypto — never import from React Native / app code (would break the Metro bundle).
import { createHmac, timingSafeEqual } from "node:crypto";
import { eventSigningPayload, type StationEvent } from "../ble/protocol";

// Verify a station-signed event's HMAC against the per-station secret.
// Constant-time compare to avoid timing leaks. Returns false on any length/format mismatch.
// `secretHex` is a 64-hex-char (32-byte) station secret. It is hex-DECODED to its
// raw 32 key bytes before keying the HMAC — matching the firmware's signing key and
// supabase/functions/_shared/blesign.ts::hmacSha256Hex. Do NOT pass the utf8 hex
// string as the key directly; that would not match and every signature would fail.
export function verifyEventSig(e: StationEvent, secretHex: string): boolean {
  const expected = createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(eventSigningPayload(e))
    .digest("hex");
  let a: Buffer, b: Buffer;
  try {
    // Non-hex/odd-length sig is caught by the length guard below (Buffer.from(..,"hex") truncates, never throws).
    // The try/catch exists for a NON-STRING sig (undefined/number) from adversarial wire JSON — sig:string is
    // not a runtime guarantee at the trust boundary, and Buffer.from(non-string, "hex") throws. Keep the
    // length-guarded constant-time compare inside the try so the whole code path is covered.
    a = Buffer.from(expected, "hex");
    b = Buffer.from(e.sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Courier delivery is at-least-once and may arrive out of order via different phones.
// Dedupe by (station_id, seq). Mutates `seen`; returns true if already seen.
// NOTE: `seen` never shrinks. The caller MUST scope/evict it (e.g. per-session, windowed, or a TTL-backed store) — do not pass a long-lived process-global Set.
export function isDuplicate(seen: Set<string>, stationId: string, seq: number): boolean {
  const key = `${stationId}:${seq}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
