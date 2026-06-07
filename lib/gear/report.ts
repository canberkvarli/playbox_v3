/**
 * Pure helpers for the photo-on-return + lost-gear feature.
 *
 * This module is intentionally PURE: no react-native, no @/lib/supabase, no
 * expo imports. The UI + upload code compose these helpers; Jest imports this
 * file directly. Every export is total (never throws).
 *
 * Mirrors the Task-1 migration `supabase/migrations/20260607120000_gear_reports.sql`:
 *   columns user_id, ble_session_id, station_id, gate, kind, message, photo_path, status
 *   storage path convention: return-photos/<user_id>/<ble_session_id>.jpg
 */

/** The allowed `kind` values (matches the SQL CHECK constraint). */
export const GEAR_REPORT_KINDS = ['lost', 'damaged', 'wrong_item', 'other'] as const;

export type GearReportKind = (typeof GEAR_REPORT_KINDS)[number];

/** Type guard: true only for one of the four known report kinds. */
export function isValidReportKind(k: unknown): k is GearReportKind {
  return typeof k === 'string' && (GEAR_REPORT_KINDS as readonly string[]).includes(k);
}

/** Max stored length of the free-text message (trimmed, then capped). */
export const MAX_REPORT_MESSAGE = 1000;

/**
 * True when a path segment is safe to embed in a storage object path:
 * non-empty after trim, and free of any `/` (would cross folders) or `..`
 * (would escape the per-user namespace) — path-safety so we never build a
 * traversal or cross-user object path.
 */
function isSafeSegment(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes('/')) return false;
  if (trimmed.includes('..')) return false;
  return true;
}

/**
 * Build the object path WITHIN the `return-photos` bucket for a return photo:
 *
 *     `${userId}/${bleSessionId}.jpg`
 *
 * Note: this is the in-bucket object path only — it does NOT prefix the bucket
 * name (the storage client takes the bucket separately).
 *
 * Returns `null` (rather than throwing) when either input is empty/whitespace,
 * or when either input contains a `/` or `..` — never produce a traversal or
 * cross-user path. The first segment must equal the caller's user id so it
 * satisfies the bucket's owner-only RLS policy.
 */
export function returnPhotoPath(userId: string, bleSessionId: string): string | null {
  if (typeof userId !== 'string' || typeof bleSessionId !== 'string') return null;
  if (!isSafeSegment(userId) || !isSafeSegment(bleSessionId)) return null;
  return `${userId.trim()}/${bleSessionId.trim()}.jpg`;
}

type BuildResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Build a snake_case insert row for `public.gear_reports`, validating inputs.
 *
 * - `kind` must pass {@link isValidReportKind} → otherwise `{ ok:false, error:'invalid_kind' }`.
 * - `userId` must be a non-empty (after trim) string → otherwise `{ ok:false, error:'missing_user_id' }`.
 * - Optional fields (ble_session_id, station_id, gate, message, photo_path) are
 *   OMITTED when null/undefined/empty — we never insert empty strings or nulls,
 *   letting the DB defaults / nullable columns apply.
 * - `message` is trimmed and capped to {@link MAX_REPORT_MESSAGE} chars.
 * - `status` is always seeded to 'open'.
 *
 * Pure + total: never throws.
 */
export function buildGearReportRow(input: {
  userId: string;
  bleSessionId?: string | null;
  stationId?: string | null;
  gate?: number | null;
  kind: string;
  message?: string | null;
  photoPath?: string | null;
}): BuildResult {
  if (!isValidReportKind(input.kind)) {
    return { ok: false, error: 'invalid_kind' };
  }

  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (userId.length === 0) {
    return { ok: false, error: 'missing_user_id' };
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    kind: input.kind,
    status: 'open',
  };

  const bleSessionId = optionalString(input.bleSessionId);
  if (bleSessionId !== undefined) row.ble_session_id = bleSessionId;

  const stationId = optionalString(input.stationId);
  if (stationId !== undefined) row.station_id = stationId;

  if (typeof input.gate === 'number' && Number.isFinite(input.gate)) {
    row.gate = input.gate;
  }

  const message = optionalString(input.message);
  if (message !== undefined) {
    row.message = message.slice(0, MAX_REPORT_MESSAGE);
  }

  const photoPath = optionalString(input.photoPath);
  if (photoPath !== undefined) row.photo_path = photoPath;

  return { ok: true, row };
}

/** Trim a maybe-string; return undefined when null/undefined/empty-after-trim. */
function optionalString(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
