// PURE predicate for the return-photo reaper. No Supabase, no Deno — so Jest can
// import it directly (same pattern as ../session-sweep/abandoned.ts).
//
// A closing/return photo lives in the private `return-photos` bucket. It is a
// nice-to-have audit artifact, NOT something we keep forever: KVKK data
// minimisation says delete it once it is no longer needed. "No longer needed" =
//   * it is older than the retention window, AND
//   * no OPEN/REVIEWING gear_report still references it (a live dispute must keep
//     its evidence until ops resolves it).
//
// The reaper deletes the storage OBJECT only. The gear_reports ROW (proof that a
// report existed, its timestamps + outcome) is always retained — we merely null
// its photo_path once the image is gone.

export type ReapCandidate = {
  /** storage.objects.created_at, ISO string. */
  created_at: string | null;
  /** true when an open/reviewing gear_report references this object's path. */
  hasLiveDispute: boolean;
};

/**
 * True when this photo object should be deleted now.
 *
 * Rules (all must hold):
 *   - NOT referenced by a live (open/reviewing) dispute — else keep the evidence.
 *   - created_at is a parseable timestamp — else keep (never delete on bad data).
 *   - strictly OLDER than the retention window (nowMs - created > retentionMs).
 *
 * Total + pure: never throws.
 */
export function shouldReapPhoto(
  o: ReapCandidate,
  nowMs: number,
  retentionMs: number,
): boolean {
  if (!o || o.hasLiveDispute) return false;
  if (typeof o.created_at !== "string") return false;
  const t = Date.parse(o.created_at);
  if (!Number.isFinite(t)) return false;
  return nowMs - t > retentionMs;
}
