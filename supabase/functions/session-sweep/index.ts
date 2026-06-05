// @ts-nocheck — Deno runtime
//
// session-sweep
// A cron-driven sweep with TWO passes. It COMPLEMENTS (does NOT replace) the
// existing reservation-sweep: that one captures reservations that EXPIRE before
// being consumed; THIS one handles the opposite case — a session physically
// OPENED (gate_opened set opened_at) but NEVER returned (returned_at null).
//
//   Pass 1 (abandoned): a reservation in (active|consumed) that was opened, never
//     returned, and is now past the max in-use window is flagged
//     penalty_eligible_at + audited with a reservation_events row kind='abandoned'.
//     NO money capture — Phase 2 reads penalty_eligible_at and captures the hold.
//     Idempotent: the `penalty_eligible_at is null` query filter + the pure
//     shouldFlagAbandoned guard make a re-run a no-op.
//
//   Pass 2 (reconcile backstop): drain any station_events with reconciled_at IS
//     NULL for stations that have gone quiet (no further courier traffic to drive
//     ingest-events Step B). Reuses the EXACT ingest reconcile path
//     (getUnreconciledEvents -> reconcileEvent -> markReconciled). One failing
//     event must not block others (per-row try/catch/continue), matching ingest.
//
// Intended to be called by pg_cron with the service-role JWT (see
// 20260605130000_session_sweep_cron.sql). Guarded the same way reservation-sweep
// guards invocation: service-role JWT required (or a caller-scoped user JWT).
//
// MONEY SEAM: this function NEVER calls iyzico. See the `// PHASE 2:` marker in
// Pass 1. Settlement is Phase 2's job.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (autopopulated).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { handleOptions, json } from "../_shared/cors.ts";
import { getRoleFromRequest, getUserIdFromRequest } from "../_shared/auth.ts";
import { getAppConfig } from "../_shared/reservations.ts";
import { reconcileEvent } from "../ingest-events/reconcile.ts";
import { SupabaseReconcileStore } from "../_shared/reconcile-store.ts";
import { shouldFlagAbandoned } from "./abandoned.ts";

// Fallback when app_config has no `max_session_in_use_min` row (minutes).
const DEFAULT_MAX_SESSION_IN_USE_MIN = 90;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  // Same invocation guard as reservation-sweep: service-role (pg_cron) OR a
  // caller-scoped user JWT. Anything else is rejected.
  const role = getRoleFromRequest(req);
  const userId = getUserIdFromRequest(req);
  const isServiceRole = role === "service_role";
  if (!isServiceRole && !userId) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "service_role_missing" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Read the tunable from app_config the same way reservation-sweep does. The
  // value is jsonb; default if the row is absent or non-numeric.
  let maxInUseMin = DEFAULT_MAX_SESSION_IN_USE_MIN;
  try {
    const cfg = await getAppConfig(admin);
    const raw = (cfg as Record<string, unknown>).max_session_in_use_min;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) maxInUseMin = n;
  } catch (e) {
    // app_config read failed — fall back to the default rather than aborting.
    console.error("[session-sweep] app_config read failed; using default", e);
  }
  const maxInUseMs = maxInUseMin * 60 * 1000;
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();

  // ----- Pass 1: abandoned (opened, never-returned, past max in-use) -----
  // Pre-filter in SQL to exactly the candidate set; the pure guard re-checks the
  // duration (and stays the single source of truth for the rule).
  let abandonedFlagged = 0;
  try {
    let q = admin
      .from("reservations")
      .select("id, status, opened_at, returned_at, penalty_eligible_at")
      .in("status", ["active", "consumed"])
      .not("opened_at", "is", null)
      .is("returned_at", null)
      .is("penalty_eligible_at", null)
      .limit(isServiceRole ? 200 : 5);
    if (!isServiceRole) q = q.eq("user_id", userId);

    const { data: rows, error } = await q;
    if (error) {
      console.error("[session-sweep] abandoned query failed", error);
    } else {
      for (const r of rows ?? []) {
        if (!shouldFlagAbandoned(r, nowMs, maxInUseMs)) continue;
        try {
          // Idempotent: re-filtered by `penalty_eligible_at is null` above, so a
          // second sweep over the same row won't double-flag.
          await admin
            .from("reservations")
            .update({ penalty_eligible_at: nowISO })
            .eq("id", r.id)
            .is("penalty_eligible_at", null);
          await admin.from("reservation_events").insert({
            reservation_id: r.id,
            kind: "abandoned",
            payload: { opened_at: r.opened_at, reason: "max_in_use_exceeded" },
          });
          // PHASE 2: consume penalty_eligible_at via iyzico here — capture the
          // hold for the abandoned (never-returned) ball. No money moves in
          // Phase 1; we only set the flag + audit row above.
          abandonedFlagged += 1;
        } catch (e) {
          // One row's failure must not block the rest of the pass.
          console.error("[session-sweep] flag abandoned failed", { id: r.id, e });
        }
      }
    }
  } catch (e) {
    console.error("[session-sweep] abandoned pass threw", e);
  }

  // ----- Pass 2: reconcile backstop drain -----
  // For stations whose station_events still have reconciled_at IS NULL (no
  // further courier traffic to drive ingest-events Step B), drain them via the
  // EXACT ingest reconcile path. Per-row try/catch/continue mirrors ingest Step B
  // so one poisoned event is logged + skipped, never blocking the rest.
  const store = new SupabaseReconcileStore(admin);
  let reconciledBackstop = 0;
  try {
    const { data: pendingStations, error: psErr } = await admin
      .from("station_events")
      .select("station_id")
      .is("reconciled_at", null);
    if (psErr) {
      console.error("[session-sweep] unreconciled station query failed", psErr);
    } else {
      const stationIds = [
        ...new Set((pendingStations ?? []).map((r: any) => r.station_id as string)),
      ];
      for (const stationId of stationIds) {
        try {
          const pending = await store.getUnreconciledEvents(stationId);
          for (const row of pending) {
            try {
              await reconcileEvent(store, stationId, row.raw as any, nowISO);
              await store.markReconciled(row.id, nowISO);
              reconciledBackstop += 1;
            } catch (e) {
              // Leave reconciled_at NULL so this exact row is retried next sweep.
              console.error("[session-sweep] reconcile failed", { seq: row.seq, e });
            }
          }
        } catch (e) {
          // Listing one station's queue failed — skip it, keep draining others.
          console.error("[session-sweep] station drain threw", { stationId, e });
        }
      }
    }
  } catch (e) {
    console.error("[session-sweep] backstop pass threw", e);
  }

  return json({
    ok: true,
    abandoned_flagged: abandonedFlagged,
    reconciled_backstop: reconciledBackstop,
    mode: isServiceRole ? "cron" : "user",
  });
});
