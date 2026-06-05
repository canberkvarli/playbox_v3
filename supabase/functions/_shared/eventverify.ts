// Deno-side verifier for station-signed events (Supabase functions runtime).
//
// Reuses the repo's already-trusted `hmacSha256Hex` from ./blesign.ts — the SAME
// signer the server uses to sign unlock commands and that the firmware keys its
// HMAC with (64-hex secret → 32 raw key bytes). This guarantees the Node verify
// (lib/server/eventVerify.ts) and this Deno verify produce identical signatures;
// __fixtures__/event-signing-vectors.json pins that parity for both runtimes.
import { hmacSha256Hex } from "./blesign.ts";
import { eventSigningPayload } from "./canonical.ts";

// Constant-time-ish char compare over two equal-length hex strings. Avoids early
// return on first mismatch to reduce timing leakage. Both inputs are lowercase
// hex of identical length (length-checked by the caller).
function constantTimeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Verify a station event's HMAC against the per-station secret.
// `secretHex` is a 64-hex (32-byte) secret, hex-decoded to raw key bytes by
// hmacSha256Hex. Returns false on any missing/non-string sig or length mismatch.
export async function verifyEventSig(
  ev: Record<string, unknown>,
  secretHex: string,
): Promise<boolean> {
  const sig = ev.sig;
  if (typeof sig !== "string") return false;
  // ASYMMETRY: a malformed (non-64-hex) station secret throws here (a server
  // config error), unlike the Node verifyEventSig which returns false. Acceptable
  // because the secret is server-controlled config, not attacker wire input.
  const expected = await hmacSha256Hex(secretHex, eventSigningPayload(ev));
  const got = sig.toLowerCase();
  if (got.length !== expected.length) return false;
  return constantTimeEqual(expected, got);
}
