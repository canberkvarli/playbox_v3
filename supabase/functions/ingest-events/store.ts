// @ts-nocheck — Deno runtime
//
// Supabase-backed implementation of the PURE `ReconcileStore` port (defined in
// ./reconcile.ts). All the domain logic lives in reconcile.ts; this file is
// thin I/O glue against supabase-js. It is NOT Jest-tested (it needs Deno +
// a live DB); the in-memory FakeStore in lib/server/reconcile.test.ts exercises
// the same port surface.
import type { ReconcileStore, Reservation } from "./reconcile.ts";

// Supabase admin client type is `any` under @ts-nocheck; we keep the param
// loosely typed to avoid pulling supabase-js types into this module.
export class SupabaseReconcileStore implements ReconcileStore {
  constructor(private readonly admin: any) {}

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
