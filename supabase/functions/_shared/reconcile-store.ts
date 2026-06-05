// @ts-nocheck — Deno runtime
//
// Supabase-backed implementation of the PURE `ReconcileStore` port (defined in
// ../ingest-events/reconcile.ts). All the domain logic lives in reconcile.ts;
// this file is thin I/O glue against supabase-js. It is NOT Jest-tested (it needs
// Deno + a live DB); the in-memory FakeStore in lib/server/reconcile.test.ts
// exercises the same port surface.
//
// Lives in _shared/ so BOTH callers import it: ingest-events (Step B reconcile)
// and session-sweep (Pass 2 backstop drain of stations gone quiet).
import type { ReconcileStore, Reservation } from "../ingest-events/reconcile.ts";

// A station_events queue row, as the ingest orchestration needs it to rebuild a
// StationEvent for reconcile. Distinct from the domain `ReconcileStore` port.
export type UnreconciledRow = {
  id: number;
  seq: number;
  raw: Record<string, unknown>;
};

// EventQueueStore is the ingest-orchestration concern (NOT the domain
// ReconcileStore port). It manages the durable station_events retry queue:
// listing the rows that still need reconciling, marking them reconciled on
// success, and reporting which seqs ARE reconciled (so the cursor never acks
// past an un-reconciled gap). reconcile.ts stays unaware of any of this.
export interface EventQueueStore {
  getUnreconciledEvents(stationId: string): Promise<UnreconciledRow[]>;
  markReconciled(eventId: number, nowISO: string): Promise<void>;
  getReconciledSeqs(stationId: string): Promise<number[]>;
}

// Supabase admin client type is `any` under @ts-nocheck; we keep the param
// loosely typed to avoid pulling supabase-js types into this module.
export class SupabaseReconcileStore implements ReconcileStore, EventQueueStore {
  constructor(private readonly admin: any) {}

  // --- EventQueueStore (ingest orchestration; not the domain port) ---------

  // All station_events for this station still awaiting reconciliation,
  // seq-ascending so effects apply in physical order. Includes both rows just
  // inserted this call AND any left un-reconciled by a prior failed reconcile.
  async getUnreconciledEvents(stationId: string): Promise<UnreconciledRow[]> {
    const { data, error } = await this.admin
      .from("station_events")
      .select("id, seq, raw")
      .eq("station_id", stationId)
      .is("reconciled_at", null)
      .order("seq", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: Number(r.id),
      seq: Number(r.seq),
      raw: r.raw as Record<string, unknown>,
    }));
  }

  // Mark one row reconciled. Called only AFTER reconcileEvent succeeded, so a
  // crash before this point leaves reconciled_at null => the row is retried.
  async markReconciled(eventId: number, nowISO: string): Promise<void> {
    const { error } = await this.admin
      .from("station_events")
      .update({ reconciled_at: nowISO })
      .eq("id", eventId);
    if (error) throw error;
  }

  // The seqs that ARE reconciled (reconciled_at not null). computeAckedSeq walks
  // these so acked_seq advances only over CONTIGUOUS reconciled seqs — never
  // past a stored-but-unreconciled gap.
  async getReconciledSeqs(stationId: string): Promise<number[]> {
    const { data, error } = await this.admin
      .from("station_events")
      .select("seq")
      .eq("station_id", stationId)
      .not("reconciled_at", "is", null);
    if (error) throw error;
    return (data ?? []).map((r: any) => Number(r.seq));
  }

  // --- ReconcileStore (pure domain port impl) ------------------------------

  async getReservationBySession(sessionId: string): Promise<Reservation | null> {
    const { data, error } = await this.admin
      .from("reservations")
      .select(
        "id, status, ble_session_id, opened_at, returned_at, release_eligible_at, penalty_eligible_at, reversal_eligible_at",
      )
      .eq("ble_session_id", sessionId)
      // A session_id is linked to at most one reservation (sign-unlock sets it),
      // but order deterministically just in case and take the newest.
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as Reservation) ?? null;
  }

  async updateReservation(id: string, fields: Partial<Reservation>): Promise<void> {
    const { error } = await this.admin
      .from("reservations")
      .update(fields)
      .eq("id", id);
    if (error) throw error;
  }

  async appendReservationEvent(
    reservationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.admin.from("reservation_events").insert({
      reservation_id: reservationId,
      kind,
      payload,
    });
    if (error) throw error;
  }

  async updateStation(stationId: string, fields: Record<string, unknown>): Promise<void> {
    const { error } = await this.admin
      .from("stations")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("station_id", stationId);
    if (error) throw error;
  }
}
