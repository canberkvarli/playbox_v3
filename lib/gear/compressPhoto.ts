/**
 * Best-effort client-side shrink of a captured return/closing photo BEFORE it is
 * uploaded to the private `return-photos` bucket.
 *
 * Why: a raw camera capture is 2-8 MB. These are evidence photos, not gallery
 * shots — a 1600px-wide JPEG at quality 0.5 (~150-400 KB) is plenty to see the
 * ball / gate condition, and it is ~10x smaller. Combined with the server-side
 * reaper (supabase/functions/photo-reap) it keeps storage tiny.
 *
 * Safe-import, same pattern as expo-image-picker in app/(tabs)/play.tsx: if the
 * native module is not linked into THIS binary (e.g. shipped over OTA before the
 * next build), `require` still resolves the JS but the first call throws — we
 * catch and return null, and the caller uploads the ORIGINAL capture unchanged.
 * Nothing here is ever a gate on finishing a session.
 */
let ImageManipulator: any = null;
try {
  ImageManipulator = require('expo-image-manipulator');
} catch {}

export type CompressedPhoto = { base64: string; uri: string };

/** Longest-edge cap + JPEG quality for the shrunk evidence photo. */
export const RETURN_PHOTO_MAX_WIDTH = 1600;
export const RETURN_PHOTO_QUALITY = 0.5;

/**
 * Resize + recompress the image at `uri`, returning `{ base64, uri }` of the
 * shrunk JPEG, or `null` if the manipulator is unavailable or anything fails
 * (caller must fall back to the original bytes). Never throws.
 */
export async function compressReturnPhoto(
  uri: string,
): Promise<CompressedPhoto | null> {
  if (!uri || !ImageManipulator) return null;
  const SaveFormat = ImageManipulator.SaveFormat ?? { JPEG: 'jpeg' };
  const opts = { compress: RETURN_PHOTO_QUALITY, format: SaveFormat.JPEG, base64: true };
  const actions = [{ resize: { width: RETURN_PHOTO_MAX_WIDTH } }];

  try {
    // Legacy API (still exported through SDK 57). Resizing by width only keeps
    // the aspect ratio, so both portrait and landscape are bounded sensibly.
    if (typeof ImageManipulator.manipulateAsync === 'function') {
      const out = await ImageManipulator.manipulateAsync(uri, actions, opts);
      if (out?.base64) return { base64: out.base64, uri: out.uri };
    }
    // New context API (SDK 52+), in case the legacy export is dropped later.
    const Ctx = ImageManipulator.ImageManipulator;
    if (Ctx && typeof Ctx.manipulate === 'function') {
      const ref = await Ctx.manipulate(uri)
        .resize({ width: RETURN_PHOTO_MAX_WIDTH })
        .renderAsync();
      const out = await ref.saveAsync(opts);
      if (out?.base64) return { base64: out.base64, uri: out.uri };
    }
    return null;
  } catch {
    // Any failure (module not linked in this binary, decode error, OOM) → the
    // caller uploads the original capture. Shrinking is a nice-to-have.
    return null;
  }
}
