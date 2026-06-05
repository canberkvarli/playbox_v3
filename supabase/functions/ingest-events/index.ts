// @ts-nocheck — Deno runtime
//
// ingest-events
// The server's ingress for station-signed, courier-relayed BLE events. A phone
// (the "courier") buffers `StationEvent`s it received over BLE and POSTs them
// here. The courier may NOT be the renter — events are trusted by their HMAC
// `sig` (verified against the per-station secret), NOT by who uploaded them.
// Any authenticated user may courier.
//
// DURABLE INGEST is DECOUPLED from RECONCILIATION so a failed reconcile is
// never masked by the (station_id,seq) dedupe gate:
//   Step A (durable ingest): for each event verify the HMAC sig
//      (_shared/eventverify.ts) — invalid => rejected. Valid => upsert into
//      station_events onConflict (station_id,seq) ignoreDuplicates, with
//      reconciled_at left NULL. `accepted` = rows newly inserted this call,
//      `deduped` = rows already present. These counts describe INGEST only —
//      NOT whether anything was reconciled.
//   Step B (reconcile the queue): SELECT all station_events for this station
//      where reconciled_at IS NULL (seq-ascending), run the PURE reconcileEvent()
//      per row, and on success set reconciled_at = now on that row. A row left
//      from a PRIOR failed reconcile is drained here too — the retry path the
//      dedupe gate can't see. One poisoned event is logged + skipped; it does
//      NOT block the rest. `reconciled` = rows succeeded THIS call.
//   Step C (cursor): advance acked_seq over CONTIGUOUS *reconciled* seqs only,
//      so we never ack past an event we stored but haven't reconciled.
// A later sweep (Phase 1 Task 5) can also drain reconciled_at IS NULL for
// stations getting no further courier traffic; this ingest-time drain is the
// primary path, the sweep is a backstop.
//
// MONEY SEAM: this function NEVER calls iyzico. reconcileEvent only sets the
// `*_eligible_at` flags + writes audit rows. See the `// PHASE 2:` markers below
// for where settlement (capture/release/reverse) will later be triggered.
//
// DEPLOY: deploy with --no-verify-jwt is NOT required — any authenticated user
// is fine and the gateway's JWT check is acceptable. (If couriers need to upload
// without a Supabase session, redeploy --no-verify-jwt and rely solely on sig.)
//
// Request:  { station_id, events: StationEvent[], ack?: { acked_seq } }
// Success:  { ok: true, accepted, deduped, rejected, reconciled, acked_seq }
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (autopopulated)
//   PLAYBOX_STATION_SECRET_<STATION_ID> — 64 hex chars, per-station env fallback
//     used when stations.secret_vault_id is null.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { handleOptions, json } from "../_shared/cors.ts";
import { getBearerToken, getUserIdFromRequest } from "../_shared/auth.ts";
import { verifyEventSig } from "../_shared/eventverify.ts";
import { reconcileEvent, computeAckedSeq } from "./reconcile.ts";
import { SupabaseReconcileStore } from "../_shared/reconcile-store.ts";

type Ack = { acked_seq: number };
type Input = {
  station_id?: string;
  events?: Array<Record<string, unknown>>;
  ack?: Ack;
};

// Per-station secret resolution. Prefer a Vault read via
// stations.secret_vault_id; fall back to the same env-var convention as
// _shared/blesign.ts (PLAYBOX_STATION_SECRET_<SANITIZED_ID>) when null.
async function loadStationSecret(
  admin: any,
  stationId: string,
  secretVaultId: string | null,
): Promise<string | null> {
  if (secretVaultId) {
    // vault.decrypted_secrets is a privileged view exposing decrypted secret
    // values to the service role. Selecting by id returns the 64-hex secret.
    const { data, error } = await admin
      .schema("vault")
      .from("decrypted_secrets")
      .select("decrypted_secret")
      .eq("id", secretVaultId)
      .maybeSingle();
    if (error) {
      console.error("[ingest-events] vault read failed", error);
    } else if (data?.decrypted_secret) {
      return data.decrypted_secret as string;
    }
    // fall through to env on any vault miss/error
  }
  // Env-var fallback — mirrors getStationSecret() in _shared/blesign.ts.
  const sanitized = stationId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const fromEnv = Deno.env.get(`PLAYBOX_STATION_SECRET_${sanitized}`);
  return fromEnv ?? null;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Auth: ANY authenticated user may courier. We capture user_id only to stamp
  // station_events.received_by (audit) — it is NOT used to authorize the events
  // themselves (those are trusted via their per-event HMAC sig).
  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: "unauthorized" }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const stationId = input.station_id;
  const events = Array.isArray(input.events) ? input.events : null;
  if (!stationId || !events) return json({ ok: false, error: "bad_request" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "service_role_missing" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Load the station row (must exist; station_events FKs it) + its secret ref.
  const { data: station, error: stationErr } = await admin
    .from("stations")
    .select("station_id, secret_vault_id, acked_seq")
    .eq("station_id", stationId)
    .maybeSingle();
  if (stationErr) {
    console.error("[ingest-events] station lookup failed", stationErr);
    return json({ ok: false, error: "station_lookup_failed" }, 500);
  }
  if (!station) return json({ ok: false, error: "unknown_station" }, 404);

  const secretHex = await loadStationSecret(admin, stationId, station.secret_vault_id);
  if (!secretHex) return json({ ok: false, error: "station_secret_missing" }, 500);

  const store = new SupabaseReconcileStore(admin);
  const nowISO = new Date().toISOString();

  let accepted = 0;
  let deduped = 0;
  let rejected = 0;
  let reconciled = 0;

  // ---- Step A: durable ingest -------------------------------------------
  // Verify each event's sig, then upsert it with reconciled_at left NULL. We do
  // NOT reconcile here — reconciliation is driven purely by reconciled_at IS
  // NULL in Step B, so a row left un-reconciled by a prior failed reconcile is
  // re-driven even though its (station_id,seq) is now a dedupe hit (isNew=false).
  for (const ev of events) {
    // verify HMAC — never trust uploader, only the signature.
    let ok = false;
    try {
      ok = await verifyEventSig(ev, secretHex);
    } catch (e) {
      // A malformed station secret throws (server config error) — treat as
      // rejected rather than crashing the whole batch.
      console.error("[ingest-events] verify threw", e);
      ok = false;
    }
    if (!ok) {
      rejected += 1;
      continue;
    }

    const seq = typeof ev.seq === "number" ? ev.seq : null;
    if (seq == null) {
      rejected += 1;
      continue;
    }

    // dedupe-insert. onConflict (station_id, seq) + ignoreDuplicates means a
    // re-relayed event collapses to the existing row. isNew (selected back) just
    // distinguishes accepted vs deduped for the response — it NO LONGER gates
    // reconciliation. reconciled_at is left NULL for Step B to pick up.
    const { data: inserted, error: insErr } = await admin
      .from("station_events")
      .upsert(
        {
          station_id: stationId,
          seq,
          event: ev.event,
          gate: ev.gate ?? null,
          session_id: ev.session_id ?? null,
          wall_ts: ev.ts ?? 0,
          sig: ev.sig,
          raw: ev,
          received_by: userId,
        },
        { onConflict: "station_id,seq", ignoreDuplicates: true },
      )
      .select("id");

    if (insErr) {
      console.error("[ingest-events] station_events upsert failed", insErr);
      rejected += 1;
      continue;
    }

    const isNew = Array.isArray(inserted) && inserted.length > 0;
    if (isNew) accepted += 1;
    else deduped += 1;
  }

  // ---- Step B: reconcile the durable queue ------------------------------
  // Drain every station_events row with reconciled_at IS NULL, seq-ascending.
  // This is the retry path the dedupe gate can't mask: failed reconciles stay
  // null and get re-driven on the next call. Each row's reconciled_at is set
  // ONLY after reconcileEvent succeeds. One poisoned event is logged + skipped
  // (its reconciled_at stays null for next time) and must NOT block the rest.
  try {
    const pending = await store.getUnreconciledEvents(stationId);
    for (const row of pending) {
      try {
        // The raw payload is the verified StationEvent we stored.
        await reconcileEvent(store, stationId, row.raw as any, nowISO);
        // PHASE 2: consume *_eligible_at via iyzico here — when reconcile set
        // release_eligible_at (unlock_timeout / gate_closed) trigger a release,
        // and when reversal_eligible_at is set (late_return_after_penalty)
        // reverse the penalty. No money moves in Phase 1.
        //
        // KNOWN MINOR (acceptable, do not add cross-table transactions): if
        // updateReservation succeeded but appendReservationEvent then threw, a
        // retry sees returned_at already set => gate_closed short-circuits to
        // already_returned, so the audit row is never re-appended. State +
        // release_eligible_at are still correct => no wrongful penalty; only the
        // audit row is missing. Acceptable degradation.
        await store.markReconciled(row.id, nowISO);
        reconciled += 1;
      } catch (e) {
        // Leave reconciled_at NULL so the next ingest call / sweep retries this
        // exact row. Continue — a single poisoned event must not block others.
        console.error("[ingest-events] reconcile failed", { seq: row.seq, e });
      }
    }
  } catch (e) {
    // Listing the queue failed; nothing reconciled this call. The rows are
    // durably stored, so a later call retries. Don't fail the whole request.
    console.error("[ingest-events] queue drain threw", e);
  }

  // ---- Step C: advance the acked cursor over RECONCILED seqs only --------
  // computeAckedSeq walks CONTIGUOUS reconciled seqs, so acked_seq can never
  // pass a seq we stored but haven't reconciled — the courier won't drop an
  // event the server hasn't durably applied.
  let ackedSeq = station.acked_seq ?? 0;
  let lastEventSeq = ackedSeq;
  try {
    const reconciledSeqs = await store.getReconciledSeqs(stationId);
    ackedSeq = computeAckedSeq(station.acked_seq ?? 0, reconciledSeqs);

    // last_event_seq tracks the highest seq ever OBSERVED (stored), reconciled
    // or not — a separate concern from the acked cursor.
    const { data: seqRows, error: seqErr } = await admin
      .from("station_events")
      .select("seq")
      .eq("station_id", stationId)
      .order("seq", { ascending: false })
      .limit(1);
    if (seqErr) {
      console.error("[ingest-events] max seq load failed", seqErr);
      lastEventSeq = Math.max(ackedSeq, ...reconciledSeqs.length ? reconciledSeqs : [ackedSeq]);
    } else {
      lastEventSeq = seqRows?.length ? Number(seqRows[0].seq) : ackedSeq;
    }

    const { error: updErr } = await admin
      .from("stations")
      .update({
        acked_seq: ackedSeq,
        last_event_seq: lastEventSeq,
        last_seen_at: nowISO,
        updated_at: nowISO,
      })
      .eq("station_id", stationId);
    if (updErr) console.error("[ingest-events] station cursor update failed", updErr);
  } catch (e) {
    console.error("[ingest-events] cursor advance threw", e);
  }

  return json({ ok: true, accepted, deduped, rejected, reconciled, acked_seq: ackedSeq });
});
