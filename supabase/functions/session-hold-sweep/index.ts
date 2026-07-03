// @ts-nocheck — Deno runtime
//
// session-hold-sweep
// Releases orphaned Path-B (session-prep) iyzico pre-auth holds. A hold is
// orphaned when `iyzico-preauth` recorded a `session_holds` row but the client
// never captured/released it — app killed between preauth and the session-review
// capture, or a silent capture/release fetch failure. Past a TTL we RELEASE the
// hold (iyzico cancel) so the user's card is freed.
//
// RELEASE ONLY — never capture. We can't measure the session server-side on this
// legacy path, so the safe default is to give the deposit back rather than risk
// charging for a session we can't account for. (Correct billing for an
// app-died-mid-completed-session is the larger server-authoritative session
// work; this is purely the no-orphan safety net.)
//
// COMPLEMENTS reservation-sweep / session-sweep / settlement, which only handle
// Path-A reservation holds. This is the Path-B counterpart.
//
// Service-role ONLY: it moves money across all users (mirrors settlement's strict
// guard — no user-JWT lazy path).
//
// MONEY SEAM: calls iyzico `cancel` only. checkEnv() fails SAFE — an
// unconfigured deploy is a no-op and will not move money.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (autopopulated),
// IYZICO_* (release is a safe no-op without them via checkEnv).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { handleOptions, json } from "../_shared/cors.ts";
import { getRoleFromRequest } from "../_shared/auth.ts";
import { getAppConfig } from "../_shared/reservations.ts";
import { cancel, checkEnv } from "../_shared/iyzico.ts";
import { shouldReleaseOrphanHold } from "./orphan.ts";

// Fallback when app_config has no `session_hold_ttl_min` row. Comfortably longer
// than the max session in-use window (90 min) + grace, so a still-running or
// just-finished session is never released out from under the user.
const DEFAULT_SESSION_HOLD_TTL_MIN = 120;

// Max held rows scanned per cron tick. A full page implies a backlog, drained
// next run (oldest-first ordering means the most-overdue holds go first).
const ORPHAN_SCAN_LIMIT = 200;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  // Service-role only — this moves money across users (mirror settlement).
  const role = getRoleFromRequest(req);
  if (role !== "service_role") {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Fail SAFE if iyzico isn't configured — never pretend to release.
  const env = checkEnv();
  if (!env.ok) {
    return json({ ok: true, released: 0, failed: 0, skipped: "iyzico_not_configured" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "service_role_missing" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // TTL tunable from app_config (jsonb), same convention as session-sweep.
  let ttlMin = DEFAULT_SESSION_HOLD_TTL_MIN;
  try {
    const cfg = await getAppConfig(admin);
    const n = Number((cfg as Record<string, unknown>).session_hold_ttl_min);
    if (Number.isFinite(n) && n > 0) ttlMin = n;
  } catch (e) {
    console.error("[session-hold-sweep] app_config read failed; using default", e);
  }
  const ttlMs = ttlMin * 60 * 1000;
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();

  let released = 0;
  let failed = 0;
  try {
    const { data: rows, error } = await admin
      .from("session_holds")
      .select("hold_id, user_id, amount_try, state, created_at, settle_attempts")
      .eq("state", "held")
      .order("created_at", { ascending: true })
      .limit(ORPHAN_SCAN_LIMIT);
    if (error) {
      console.error("[session-hold-sweep] query failed", error);
      return json({ ok: false, error: "query_failed" }, 500);
    }
    if ((rows?.length ?? 0) === ORPHAN_SCAN_LIMIT) {
      console.warn(`[session-hold-sweep] hit row cap (${ORPHAN_SCAN_LIMIT}) — backlog may exist, drained next run`);
    }

    for (const r of rows ?? []) {
      if (!shouldReleaseOrphanHold(r, nowMs, ttlMs)) continue;
      try {
        const res = await cancel({
          locale: "tr",
          conversationId: `sweep-release:${r.hold_id}`,
          paymentId: r.hold_id,
          ip: "0.0.0.0",
        });

        if (res.status === "success") {
          // Idempotent: only flip a still-'held' row so a concurrent client
          // resolve doesn't get clobbered.
          await admin
            .from("session_holds")
            .update({ state: "released", settled_at: nowISO, settled_by: "sweep" })
            .eq("hold_id", r.hold_id)
            .eq("state", "held");
          released += 1;
          continue;
        }

        // iyzico rejected. The most common benign cause is that the hold was
        // ALREADY captured or voided out-of-band (e.g. the client's capture
        // landed but its session_holds UPDATE didn't). Treat an already-gone
        // hold as resolved so we stop retrying it forever; otherwise record the
        // error and leave it 'held' to retry next tick.
        const msg = (res.errorMessage ?? "").toLowerCase();
        const alreadyGone =
          msg.includes("not found") ||
          msg.includes("already") ||
          msg.includes("bulunamadı") ||
          msg.includes("işlenmiş");
        if (alreadyGone) {
          await admin
            .from("session_holds")
            .update({
              state: "released",
              settled_at: nowISO,
              settled_by: "sweep",
              settle_last_error: `iyzico: ${res.errorMessage ?? "already resolved"}`,
            })
            .eq("hold_id", r.hold_id)
            .eq("state", "held");
          released += 1;
          continue;
        }

        await admin
          .from("session_holds")
          .update({
            settle_attempts: (r.settle_attempts ?? 0) + 1,
            settle_last_error: res.errorMessage ?? "release_failed",
          })
          .eq("hold_id", r.hold_id)
          .eq("state", "held");
        failed += 1;
      } catch (e) {
        // One hold's failure must not block the rest of the sweep.
        console.error("[session-hold-sweep] release threw", { hold_id: r.hold_id, e });
        failed += 1;
      }
    }
  } catch (e) {
    console.error("[session-hold-sweep] sweep threw", e);
    return json({ ok: false, error: "sweep_threw" }, 500);
  }

  return json({ ok: true, released, failed });
});
