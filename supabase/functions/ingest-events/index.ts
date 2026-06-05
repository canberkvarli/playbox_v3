// @ts-nocheck — Deno runtime
//
// ingest-events
// The server's ingress for station-signed, courier-relayed BLE events. A phone
// (the "courier") buffers `StationEvent`s it received over BLE and POSTs them
// here. The courier may NOT be the renter — events are trusted by their HMAC
// `sig` (verified against the per-station secret), NOT by who uploaded them.
// Any authenticated user may courier.
//
// For each event we:
//   1. verify the HMAC sig (Deno _shared/eventverify.ts) — invalid => rejected.
//   2. upsert into station_events with onConflict (station_id, seq),
//      ignoreDuplicates — the courier dedupe key. NEW row => reconcile + accept;
//      duplicate => deduped (no reconcile, so effects apply exactly once).
//   3. run the PURE reconcileEvent() against a Supabase-backed store, applying
//      the event's domain effects to the reservation lifecycle.
// Then we advance the station's contiguous acked_seq so the courier can safely
// drop buffered events whose seq <= acked_seq.
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
// Success:  { ok: true, accepted, deduped, rejected, acked_seq }
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
import { SupabaseReconcileStore } from "./store.ts";

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

  for (const ev of events) {
    // 1. verify HMAC — never trust uploader, only the signature.
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

    // 2. dedupe-insert. onConflict (station_id, seq) + ignoreDuplicates means a
    //    re-relayed event collapses to the existing row. We detect "was it new?"
    //    by selecting the inserted rows back: an ignored duplicate returns none.
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
    if (!isNew) {
      // Duplicate courier relay — already reconciled when first seen.
      deduped += 1;
      continue;
    }

    // 3. apply domain effects exactly once (new row only).
    try {
      await reconcileEvent(store, stationId, ev, nowISO);
      // PHASE 2: consume *_eligible_at via iyzico here — e.g. when reconcile set
      // release_eligible_at (unlock_timeout / gate_closed) trigger a release, and
      // when reversal_eligible_at is set (late_return_after_penalty) reverse the
      // penalty. No money moves in Phase 1.
      accepted += 1;
    } catch (e) {
      // The event is durably stored; reconcile is retryable. Count rejected so
      // the courier doesn't treat it as fully acked, but keep processing.
      console.error("[ingest-events] reconcile failed", { seq, event: ev.event, e });
      rejected += 1;
    }
  }

  // Advance the contiguous acked cursor. Load all stored seqs for this station
  // and compute the highest gap-free seq from the current acked_seq.
  let ackedSeq = station.acked_seq ?? 0;
  let lastEventSeq = ackedSeq;
  try {
    const { data: seqRows, error: seqErr } = await admin
      .from("station_events")
      .select("seq")
      .eq("station_id", stationId);
    if (seqErr) {
      console.error("[ingest-events] seq load failed", seqErr);
    } else {
      const storedSeqs = (seqRows ?? []).map((r: any) => Number(r.seq));
      ackedSeq = computeAckedSeq(station.acked_seq ?? 0, storedSeqs);
      lastEventSeq = storedSeqs.length ? Math.max(...storedSeqs) : ackedSeq;
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
    }
  } catch (e) {
    console.error("[ingest-events] cursor advance threw", e);
  }

  return json({ ok: true, accepted, deduped, rejected, acked_seq: ackedSeq });
});
