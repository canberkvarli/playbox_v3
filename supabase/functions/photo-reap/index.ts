// @ts-nocheck — Deno runtime
//
// photo-reap
// A cron-driven sweep that DELETES return/closing photos once they are no longer
// needed, so the private `return-photos` bucket does not grow without bound and
// we honour KVKK data-minimisation (keep personal images only as long as needed).
//
// A photo is reaped when it is OLDER than the retention window AND no OPEN or
// REVIEWING gear_report still references it (a live dispute must keep its
// evidence until ops resolves it). The single source of truth for that rule is
// the PURE `shouldReapPhoto` predicate in ./reap.ts.
//
// What it deletes vs keeps:
//   * DELETES the storage OBJECT (the actual image bytes).
//   * KEEPS the gear_reports ROW forever (proof a report existed, its timestamps
//     + outcome) — it merely NULLs photo_path once the image is gone, so the app
//     never tries to load a dead path.
//
// Note: most closing photos have NO gear_reports row at all (a report is only
// filed on lost/damaged). So the reaper works off storage.objects.created_at
// directly, NOT off gear_reports.
//
// Intended to be called by pg_cron with the service-role JWT (see
// 20260707130000_photo_reap_cron.sql). Same invocation guard as session-sweep:
// service-role JWT required (a caller-scoped user JWT is rejected — this is an
// ops-only, cross-user delete).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (autopopulated).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { handleOptions, json } from "../_shared/cors.ts";
import { getRoleFromRequest } from "../_shared/auth.ts";
import { getAppConfig } from "../_shared/reservations.ts";
import { shouldReapPhoto } from "./reap.ts";

const BUCKET = "return-photos";

// Fallback when app_config has no `return_photo_retention_days` row (days).
// 30 days = a generous dispute/complaint window while still deleting personal
// images promptly. TUNE via app_config, not here.
const DEFAULT_RETENTION_DAYS = 30;

// Max objects scanned per run. If a run returns exactly this many candidates a
// backlog likely exists and is drained on the next daily run.
const SCAN_LIMIT = 500;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  // Ops-only: pg_cron sends the service-role JWT. Reject everything else — this
  // deletes objects across ALL users, so no user-scoped path is offered.
  const role = getRoleFromRequest(req);
  if (role !== "service_role") {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "service_role_missing" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Retention window from app_config (jsonb), default if absent/non-numeric.
  let retentionDays = DEFAULT_RETENTION_DAYS;
  try {
    const cfg = await getAppConfig(admin);
    const n = Number((cfg as Record<string, unknown>).return_photo_retention_days);
    if (Number.isFinite(n) && n > 0) retentionDays = n;
  } catch (e) {
    console.error("[photo-reap] app_config read failed; using default", e);
  }
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const cutoffISO = new Date(nowMs - retentionMs).toISOString();

  // ----- Candidate objects (past retention) + live-dispute flag, one RPC -----
  // The `storage` schema is NOT exposed to PostgREST, so we cannot select from
  // storage.objects via the JS client. A SECURITY DEFINER RPC in `public` does
  // the cross-schema read AND flags objects pinned by an open/reviewing
  // gear_report (see 20260707150000_reapable_photos_rpc.sql). The pure predicate
  // below stays the single source of truth for the delete decision.
  type Candidate = { name: string; created_at: string; has_live_dispute: boolean };
  let candidates: Candidate[] = [];
  try {
    const { data, error } = await admin.rpc("reapable_return_photos", {
      older_than: cutoffISO,
      lim: SCAN_LIMIT,
    });
    if (error) {
      console.error("[photo-reap] reapable_return_photos rpc failed", error);
      return json({ ok: false, error: "objects_query_failed" }, 500);
    }
    candidates = (data ?? []) as Candidate[];
  } catch (e) {
    console.error("[photo-reap] candidate scan threw", e);
    return json({ ok: false, error: "scan_threw" }, 500);
  }

  if (candidates.length === 0) {
    return json({ ok: true, scanned: 0, deleted: 0, kept_disputed: 0 });
  }
  if (candidates.length === SCAN_LIMIT) {
    console.warn(
      `[photo-reap] hit scan cap (${SCAN_LIMIT}) — backlog may exist, will continue next run`,
    );
  }

  // ----- Decide via the pure predicate, then delete + null photo_path -----
  const keptDisputed = candidates.filter((c) => c.has_live_dispute).length;
  const toDelete = candidates
    .filter((c) =>
      shouldReapPhoto(
        { created_at: c.created_at, hasLiveDispute: c.has_live_dispute },
        nowMs,
        retentionMs,
      )
    )
    .map((c) => c.name);

  let deleted = 0;
  if (toDelete.length > 0) {
    // remove() goes through the Storage API so the underlying object is actually
    // freed (not just the DB row). Delete in chunks to keep the request small.
    const CHUNK = 100;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const batch = toDelete.slice(i, i + CHUNK);
      try {
        const { error } = await admin.storage.from(BUCKET).remove(batch);
        if (error) {
          console.error("[photo-reap] remove batch failed", error);
          continue; // one batch failing must not sink the rest
        }
        deleted += batch.length;
        // Null photo_path on any RESOLVED report that pointed at a deleted image
        // (open/reviewing were excluded above). Keep the row — only drop the dead
        // path so the app never fetches a 404.
        await admin
          .from("gear_reports")
          .update({ photo_path: null })
          .in("photo_path", batch);
      } catch (e) {
        console.error("[photo-reap] remove batch threw", e);
      }
    }
  }

  return json({
    ok: true,
    scanned: candidates.length,
    deleted,
    kept_disputed: keptDisputed,
    retention_days: retentionDays,
  });
});
