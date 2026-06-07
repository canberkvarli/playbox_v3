/**
 * Pure orchestration of the "report a gear problem" submit flow.
 *
 * This module is intentionally PURE: no react-native, no @/lib/supabase, no
 * expo imports. It composes {@link buildGearReportRow} over INJECTED ports
 * (`uploadPhoto`, `insertReport`) so Jest can import + drive it directly. The
 * UI (`components/GearReportSheet.tsx`) wires the real supabase-backed ports in.
 *
 * Semantics (mirrors the original in-sheet handler):
 *  1. Photo upload is BEST-EFFORT: a failure (or thrown error) never aborts the
 *     report — we just drop the `photo_path` and flag `photoFailed`.
 *  2. The row is built + validated; an invalid kind / missing user id returns
 *     `{ ok:false }` and NO insert is attempted.
 *  3. Insert failures (or throws) propagate as `{ ok:false, error }`.
 *
 * Pure + total: never throws — every awaited port is wrapped.
 */
import { buildGearReportRow } from './report';

export type SubmitGearReportDeps = {
  /**
   * Best-effort photo uploader. Only called when a `photoUri` AND a
   * `bleSessionId` are present (the session id keys the per-user object path).
   * Must resolve to a tagged result; if it throws we treat it as a failure.
   */
  uploadPhoto?: (
    userId: string,
    bleSessionId: string,
    fileUri: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  /** Insert the built row. Must resolve to a tagged result. */
  insertReport: (
    row: Record<string, unknown>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export type SubmitGearReportInput = {
  userId: string;
  bleSessionId?: string | null;
  stationId?: string | null;
  gate?: number | null;
  kind: string;
  message?: string | null;
  photoUri?: string | null;
  /**
   * Optional override for the session id used ONLY to key the photo object
   * path — lets a caller upload a photo (under a synthesized id) even when no
   * real `bleSessionId` exists, without polluting the row's `ble_session_id`.
   * Defaults to `bleSessionId` when omitted.
   */
  photoSessionId?: string | null;
};

export type SubmitGearReportResult =
  | { ok: true; photoUploaded: boolean; photoFailed: boolean }
  | { ok: false; error: string };

export async function submitGearReport(
  deps: SubmitGearReportDeps,
  input: SubmitGearReportInput,
): Promise<SubmitGearReportResult> {
  let photoPath: string | undefined;
  let photoUploaded = false;
  let photoFailed = false;

  // 1. Best-effort photo upload. Requires a uri, an uploader, and a session id
  //    to key the object path. Any failure/throw is swallowed → photoFailed.
  const photoUri =
    typeof input.photoUri === 'string' && input.photoUri.trim().length > 0
      ? input.photoUri
      : null;
  // The session id that keys the photo object path: prefer an explicit
  // `photoSessionId` override, else fall back to the real `bleSessionId`.
  const rawPhotoSession =
    input.photoSessionId != null ? input.photoSessionId : input.bleSessionId;
  const photoSessionId =
    typeof rawPhotoSession === 'string' && rawPhotoSession.trim().length > 0
      ? rawPhotoSession
      : null;

  if (photoUri && deps.uploadPhoto && photoSessionId) {
    try {
      const up = await deps.uploadPhoto(input.userId, photoSessionId, photoUri);
      if (up.ok) {
        photoPath = up.path;
        photoUploaded = true;
      } else {
        photoFailed = true;
      }
    } catch {
      // Best-effort: a thrown uploader still lets the report through.
      photoFailed = true;
    }
  }

  // 2. Build + validate the row. Invalid kind / missing user → NO insert.
  const built = buildGearReportRow({
    userId: input.userId,
    bleSessionId: input.bleSessionId ?? null,
    stationId: input.stationId ?? null,
    gate: input.gate ?? null,
    kind: input.kind,
    message: input.message ?? null,
    photoPath: photoPath ?? null,
  });
  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  // 3. Insert. Propagate failures; a thrown insert becomes {ok:false}.
  try {
    const inserted = await deps.insertReport(built.row);
    if (!inserted.ok) {
      return { ok: false, error: inserted.error };
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e ?? 'insert_failed') };
  }

  return { ok: true, photoUploaded, photoFailed };
}
