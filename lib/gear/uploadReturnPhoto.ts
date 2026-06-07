/**
 * Thin, best-effort uploader for a return/closing photo.
 *
 * The interesting logic (the path-safety guard) lives in the PURE helper
 * `returnPhotoPath` in `./report`. This file only does the I/O: turn a local
 * file URI into bytes and push them to the private `return-photos` bucket.
 *
 * Contract: NEVER throws. Always resolves to a tagged result. The photo is a
 * nice-to-have — a failure here must never break finishing a session.
 *
 * Object path convention (matches the migration + RLS owner-only policy):
 *   return-photos/<user_id>/<ble_session_id>.jpg
 */
import { returnPhotoPath } from './report';

type UploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Decode a base64 string to a Uint8Array without pulling in a native dep.
 * React Native ships a global `atob` (via the Hermes/JSC polyfills Expo sets
 * up); if it's missing for some reason we fall back to a tiny inline decoder.
 */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  // Prefer the platform atob when present — fastest + battle-tested.
  const g: any = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Inline fallback decoder.
  const CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;
  let bufferLength = Math.floor((clean.length * 3) / 4);
  if (clean[clean.length - 1] === '=') bufferLength--;
  if (clean[clean.length - 2] === '=') bufferLength--;
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = lookup[clean.charCodeAt(i)];
    const e2 = lookup[clean.charCodeAt(i + 1)];
    const e3 = lookup[clean.charCodeAt(i + 2)];
    const e4 = lookup[clean.charCodeAt(i + 3)];
    bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}

/**
 * Upload a JPEG at `fileUri` (or pass the base64 directly via `base64`) to the
 * `return-photos` bucket under the per-user object path. Best-effort.
 *
 * @param supabase the @supabase/supabase-js client (typed loosely so this file
 *   stays cheap to import + test).
 * @param userId   the authenticated user's id (must own the path under RLS).
 * @param bleSessionId the BLE session id — the object filename.
 * @param fileUri a local `file://` URI to read, OR a `data:`/base64 string.
 */
export async function uploadReturnPhoto(
  supabase: any,
  userId: string,
  bleSessionId: string,
  fileUri: string,
): Promise<UploadResult> {
  const path = returnPhotoPath(userId, bleSessionId);
  if (!path) return { ok: false, error: 'bad_path' };

  try {
    let body: Uint8Array;

    if (
      fileUri.startsWith('data:') ||
      // Heuristic: a bare base64 blob (no scheme) — image-picker can hand us
      // the raw base64 string directly when asked.
      (!fileUri.startsWith('file:') &&
        !fileUri.startsWith('http') &&
        !fileUri.startsWith('content:') &&
        !fileUri.startsWith('/'))
    ) {
      body = base64ToBytes(fileUri);
    } else {
      // Local file URI → fetch().blob() → arrayBuffer(). Works in RN/Expo for
      // file:// and content:// URIs. We avoid expo-file-system (not a direct
      // dep) and let the caller pass base64 for the reliable path.
      const res = await fetch(fileUri);
      const buf = await res.arrayBuffer();
      body = new Uint8Array(buf);
    }

    const { error } = await supabase.storage
      .from('return-photos')
      .upload(path, body, { contentType: 'image/jpeg', upsert: true });

    if (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
    return { ok: true, path };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e ?? 'upload_failed') };
  }
}
