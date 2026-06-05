// PURE ingest orchestration core — Deno-free, Supabase-free, esm-free.
//
// This module holds the Step A/B/C orchestration that drives durable ingest +
// reconciliation of station-signed events. It was EXTRACTED verbatim (in
// behavior) from the Deno `index.ts` so the durability semantics can be locked
// by a Jest integration test (lib/server/ingest-loop.test.ts) — the same
// Jest-can-import pattern reconcile.ts already uses.
//
// It imports nothing from Deno or supabase-js: every side effect goes through
// the injected `deps`. The Deno `index.ts` wires Supabase-backed deps; Jest
// wires in-memory fakes + the real Node `verifyEventSig`.
//
// DURABILITY CONTRACT (the bug this locks): durable ingest is DECOUPLED from
// reconciliation so a failed reconcile is never masked by the (station_id,seq)
// dedupe gate. Step A upserts each verified event with reconciled_at NULL. Step
// B drains EVERY reconciled_at-IS-NULL row (including ones left from a prior
// failed reconcile — the retry path the dedupe gate can't see) and only marks a
// row reconciled AFTER reconcileEvent succeeds; a throw leaves it NULL for retry
// and must not block the rest. Step C advances acked_seq over CONTIGUOUS
// *reconciled* seqs only, so acked_seq can never pass a stored-but-unreconciled
// gap.
//
// MONEY SEAM: this core NEVER calls iyzico or moves money. reconcileEvent only
// sets the `*_eligible_at` flags + writes audit rows. See the `// PHASE 2:`
// markers for where settlement would later be triggered.

import {
  reconcileEvent,
  computeAckedSeq,
  type ReconcileStore,
  type IngestEvent,
} from "./reconcile.ts";

// A durable station_events queue row, as the orchestration needs it to rebuild a
// StationEvent for reconcile. Mirrors _shared/reconcile-store.ts::UnreconciledRow
// (kept local so this module needs no _shared import).
export type UnreconciledRow = {
  id: number;
  seq: number;
  raw: Record<string, unknown>;
};

// The durable station_events queue port (ingest-orchestration concern; NOT the
// domain ReconcileStore port). Manages the reconciled_at retry queue + dedupe
// upsert. Mirrors _shared/reconcile-store.ts::EventQueueStore + the upsert.
export interface EventQueueStore {
  // Dedupe-insert one verified event with reconciled_at left NULL. Returns
  // { inserted: true } when a NEW row was written, { inserted: false } when the
  // (station_id, seq) already existed (a re-relayed duplicate). The duplicate
  // gate does NOT decide reconciliation — Step B re-drives any NULL row.
  upsertStationEvent(row: {
    stationId: string;
    seq: number;
    event: IngestEvent;
  }): Promise<{ inserted: boolean }>;
  // All station_events for this station awaiting reconciliation, seq-ascending.
  getUnreconciledEvents(stationId: string): Promise<UnreconciledRow[]>;
  // Mark one row reconciled — called ONLY after reconcileEvent succeeded.
  markReconciled(eventId: number, nowISO: string): Promise<void>;
  // The seqs that ARE reconciled (reconciled_at not null). Fed to computeAckedSeq.
  getReconciledSeqs(stationId: string): Promise<number[]>;
}

// Injected dependencies. The Deno shell builds these from the Supabase client +
// Deno webcrypto verifyEventSig; Jest builds in-memory fakes + Node verifyEventSig.
export type ProcessDeps = {
  // INJECTED sig verification: Node node:crypto (tests) / Deno webcrypto (prod).
  // `secretHex` is the 64-hex per-station secret.
  verifyEventSig(ev: IngestEvent, secretHex: string): Promise<boolean> | boolean;
  // Pure domain port (getReservationBySession/updateReservation/...).
  store: ReconcileStore;
  // Durable queue port (upsert/getUnreconciled/markReconciled/getReconciledSeqs).
  queue: EventQueueStore;
  // Read the station's persisted acked cursor.
  getStationAckedSeq(stationId: string): Promise<number>;
  // Persist the advanced cursor + observed max seq + last_seen.
  updateStationCursor(
    stationId: string,
    fields: { acked_seq: number; last_event_seq: number; last_seen_at: string },
  ): Promise<void>;
  // Server's trusted clock (ISO). reconcile uses it for every persisted timestamp.
  now(): string;
};

export type ProcessInput = {
  stationId: string;
  secretHex: string;
  events: IngestEvent[];
};

export type ProcessResult = {
  accepted: number;
  deduped: number;
  rejected: number;
  reconciled: number;
  acked_seq: number;
};

// Apply Step A (durable ingest) → Step B (reconcile the queue) → Step C (advance
// the acked cursor) for one POSTed batch. Behavior is identical to the prior
// inline index.ts orchestration; only the I/O is now injected.
export async function processIngest(
  deps: ProcessDeps,
  input: ProcessInput,
): Promise<ProcessResult> {
  const { stationId, secretHex, events } = input;
  const nowISO = deps.now();

  let accepted = 0;
  let deduped = 0;
  let rejected = 0;
  let reconciled = 0;
  let maxObservedSeq = -1;

  // ---- Step A: durable ingest -------------------------------------------
  // Verify each event's sig, then upsert it with reconciled_at left NULL. We do
  // NOT reconcile here — reconciliation is driven purely by reconciled_at IS
  // NULL in Step B, so a row left un-reconciled by a prior failed reconcile is
  // re-driven even though its (station_id,seq) is now a dedupe hit.
  for (const ev of events) {
    // verify HMAC — never trust uploader, only the signature.
    let ok = false;
    try {
      ok = await deps.verifyEventSig(ev, secretHex);
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
    if (seq > maxObservedSeq) maxObservedSeq = seq;

    // dedupe-insert. inserted distinguishes accepted vs deduped for the response
    // — it NO LONGER gates reconciliation. reconciled_at is left NULL for Step B.
    let result: { inserted: boolean };
    try {
      result = await deps.queue.upsertStationEvent({ stationId, seq, event: ev });
    } catch (e) {
      console.error("[ingest-events] station_events upsert failed", e);
      rejected += 1;
      continue;
    }

    if (result.inserted) accepted += 1;
    else deduped += 1;
  }

  // ---- Step B: reconcile the durable queue ------------------------------
  // Drain every station_events row with reconciled_at IS NULL, seq-ascending.
  // This is the retry path the dedupe gate can't mask: failed reconciles stay
  // null and get re-driven on the next call. Each row's reconciled_at is set
  // ONLY after reconcileEvent succeeds. One poisoned event is logged + skipped
  // (its reconciled_at stays null for next time) and must NOT block the rest.
  try {
    const pending = await deps.queue.getUnreconciledEvents(stationId);
    for (const row of pending) {
      try {
        // The raw payload is the verified StationEvent we stored.
        await reconcileEvent(deps.store, stationId, row.raw as IngestEvent, nowISO);
        // PHASE 2: consume *_eligible_at via iyzico here. No money in Phase 1.
        await deps.queue.markReconciled(row.id, nowISO);
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
  const currentAcked = await deps.getStationAckedSeq(stationId);
  let ackedSeq = currentAcked;
  let lastEventSeq = currentAcked;
  try {
    const reconciledSeqs = await deps.queue.getReconciledSeqs(stationId);
    ackedSeq = computeAckedSeq(currentAcked, reconciledSeqs);

    // last_event_seq tracks the highest seq ever OBSERVED, reconciled or not —
    // a separate concern from the acked cursor. We track the max seq we saw this
    // batch and never regress below the existing cursor.
    const reconciledMax = reconciledSeqs.length ? Math.max(...reconciledSeqs) : currentAcked;
    lastEventSeq = Math.max(currentAcked, ackedSeq, reconciledMax, maxObservedSeq);

    await deps.updateStationCursor(stationId, {
      acked_seq: ackedSeq,
      last_event_seq: lastEventSeq,
      last_seen_at: nowISO,
    });
  } catch (e) {
    console.error("[ingest-events] cursor advance threw", e);
  }

  return { accepted, deduped, rejected, reconciled, acked_seq: ackedSeq };
}
