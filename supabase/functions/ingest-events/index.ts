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
import { SupabaseReconcileStore } from "../_shared/reconcile-store.ts";
import { processIngest } from "./process.ts";

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

  // Build the injected deps for the PURE orchestration (process.ts). All Step
  // A/B/C logic + durability semantics live there now; this shell only wires the
  // Supabase-backed I/O + the Deno webcrypto verifyEventSig. Behavior is
  // identical to the prior inline orchestration.
  const deps = {
    // Stamp station_events.received_by with the courier's user_id (audit only;
    // NOT authorization — events are trusted via their per-event HMAC sig).
    verifyEventSig: (ev: any, sh: string) => verifyEventSig(ev, sh),
    store,
    queue: {
      upsertStationEvent: (row: { stationId: string; seq: number; event: any }) =>
        store.upsertStationEvent({ ...row, receivedBy: userId }),
      getUnreconciledEvents: (sid: string) => store.getUnreconciledEvents(sid),
      markReconciled: (id: number, nowISO: string) => store.markReconciled(id, nowISO),
      getReconciledSeqs: (sid: string) => store.getReconciledSeqs(sid),
    },
    getStationAckedSeq: async (_sid: string) => station.acked_seq ?? 0,
    updateStationCursor: async (
      sid: string,
      fields: { acked_seq: number; last_event_seq: number; last_seen_at: string },
    ) => {
      const { error: updErr } = await admin
        .from("stations")
        .update({
          acked_seq: fields.acked_seq,
          last_event_seq: fields.last_event_seq,
          last_seen_at: fields.last_seen_at,
          updated_at: fields.last_seen_at,
        })
        .eq("station_id", sid);
      if (updErr) {
        console.error("[ingest-events] station cursor update failed", updErr);
        throw updErr;
      }
    },
    now: () => new Date().toISOString(),
  };

  const result = await processIngest(deps, { stationId, secretHex, events });

  return json({ ok: true, ...result });
});
