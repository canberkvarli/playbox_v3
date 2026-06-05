// HMAC-SHA256 signer for BLE unlock commands.
//
// Wire format (JSON, written to UNLOCK_CHAR_UUID):
//   { cmd, gate, session_id, duration_min, ts, sig }
//
// `ts` is a unix-second timestamp. `sig` is the hex-encoded HMAC-SHA256 of
//   `${cmd}|${gate}|${session_id}|${duration_min}|${ts}`
// using the per-station secret. The firmware verifies this signature and
// rejects payloads with a `ts` not strictly greater than the last accepted
// one (monotonic-timestamp replay protection — the ESP32 has no RTC).
//
// Phase 0: secrets are pulled from env vars by station_id. Phase 1+ will
// store them in a `stations` table and look them up per-station.

export async function hmacSha256Hex(secretHex: string, payload: string): Promise<string> {
  // Station secrets are stored as 64-char hex strings (= 32 raw bytes).
  // Decode to bytes before importing — using the hex-string representation
  // as the key directly would still "work" but firmware-side mbedtls expects
  // raw bytes, so we need to match.
  if (secretHex.length !== 64 || !/^[0-9a-f]+$/i.test(secretHex)) {
    throw new Error('station secret must be 64 hex chars (32 bytes)');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type SignedUnlock = {
  cmd: 'unlock';
  gate: number;
  session_id: string;
  duration_min: number;
  ts: number;
  sig: string;
};

export type SignedReturnUnlock = {
  cmd: 'return_unlock';
  gate: number;
  session_id: string;
  ts: number;
  sig: string;
};

// Look up the per-station secret. Phase 0 sources it from env vars keyed
// by sanitized station_id. Phase 1 will replace this with a DB lookup.
function getStationSecret(stationId: string): string | null {
  const sanitized = stationId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const envKey = `PLAYBOX_STATION_SECRET_${sanitized}`;
  const fromEnv = Deno.env.get(envKey);
  if (fromEnv) return fromEnv;
  // TODO: replace with `stations` table lookup once that table exists.
  return null;
}

export async function signUnlock(input: {
  station_id: string;
  gate: number;
  session_id: string;
  duration_min: number;
}): Promise<SignedUnlock> {
  const secret = getStationSecret(input.station_id);
  if (!secret) {
    throw new Error(`no station secret configured for ${input.station_id}`);
  }
  const ts = Math.floor(Date.now() / 1000);
  const payload = `unlock|${input.gate}|${input.session_id}|${input.duration_min}|${ts}`;
  const sig = await hmacSha256Hex(secret, payload);
  return {
    cmd: 'unlock',
    gate: input.gate,
    session_id: input.session_id,
    duration_min: input.duration_min,
    ts,
    sig,
  };
}

export async function signReturnUnlock(input: {
  station_id: string;
  gate: number;
  session_id: string;
}): Promise<SignedReturnUnlock> {
  const secret = getStationSecret(input.station_id);
  if (!secret) {
    throw new Error(`no station secret configured for ${input.station_id}`);
  }
  const ts = Math.floor(Date.now() / 1000);
  // duration_min is always 0 in the canonical signing string for return_unlock
  // — keeps both command types using the same canonical form.
  const payload = `return_unlock|${input.gate}|${input.session_id}|0|${ts}`;
  const sig = await hmacSha256Hex(secret, payload);
  return {
    cmd: 'return_unlock',
    gate: input.gate,
    session_id: input.session_id,
    ts,
    sig,
  };
}
