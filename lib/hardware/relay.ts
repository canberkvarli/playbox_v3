/**
 * Pure relay helpers for forwarding station-signed BLE events to the
 * `ingest-events` Edge Function (Phase 1 server reconciliation). The renter's
 * phone acts as the primary "courier": when it receives EVENTS notifications
 * from the station, it POSTs them to the server, which verifies each event's
 * HMAC `sig` and reconciles physical truth.
 *
 * INTENTIONALLY import-free (no React Native, no supabase): all of this is
 * plain data shaping so Jest can import + unit-test it directly. The RN/network
 * wiring (`supabase.functions.invoke`) lives in `ble.ts` and consumes these.
 *
 * THE SIGNED-SHAPE GATE (`isSignedEvent`) is what makes this whole feature a
 * safe no-op today: current firmware emits UNSIGNED events (no `sig`, no `seq`),
 * so `buildIngestBatch` filters them all out and returns null → the caller
 * skips the POST entirely. Once firmware Task 5 starts emitting signed/sequenced
 * events, this lights up automatically with zero app changes.
 */

import type { StationEvent } from '@/lib/ble/protocol';

/** The Phase 1 ingest request contract (subset we build courier-side). */
export type IngestBatch = {
  station_id: string;
  events: StationEvent[];
};

/**
 * True iff `ev` carries the Phase 0 SIGNED/SEQUENCED shape the server can
 * verify: a non-empty string `sig`, a finite number `seq`, AND a string
 * `event`. This is the gate that no-ops the relay on today's unsigned firmware
 * events (which have neither `sig` nor `seq`).
 */
export function isSignedEvent(ev: unknown): ev is StationEvent {
  if (typeof ev !== 'object' || ev === null) return false;
  const e = ev as Record<string, unknown>;
  if (typeof e.event !== 'string' || e.event.length === 0) return false;
  if (typeof e.sig !== 'string' || e.sig.length === 0) return false;
  if (typeof e.seq !== 'number' || !Number.isFinite(e.seq)) return false;
  return true;
}

/**
 * Filter `events` to only the signed ones (preserving order) and wrap them in
 * the `{ station_id, events }` ingest request shape.
 *
 * Returns `null` when NONE are signed — so the caller can skip the POST
 * entirely rather than firing an empty (and pointless) request. This is the
 * no-op path for today's unsigned firmware.
 */
export function buildIngestBatch(
  stationId: string,
  events: unknown[],
): IngestBatch | null {
  const signed = events.filter(isSignedEvent);
  if (signed.length === 0) return null;
  return { station_id: stationId, events: signed };
}

/**
 * Safely extract `acked_seq` (a finite number) from the ingest-events response
 * `{ ok, accepted, deduped, rejected, reconciled, acked_seq }`. Returns null if
 * the response is malformed or `acked_seq` is absent/non-finite. Task 8 will
 * consume this to relay the ack cursor back to the station.
 */
export function pickAckedSeq(response: unknown): number | null {
  if (typeof response !== 'object' || response === null) return null;
  const seq = (response as Record<string, unknown>).acked_seq;
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return null;
  return seq;
}
