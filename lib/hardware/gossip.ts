/**
 * Pure gossip-sync + relay-coalescing helpers for the "ANY phone is a backstop
 * courier" feature (Phase 3 Task 8). On ANY station connect — even a passive
 * connection for a different user's session — the app drains the station's
 * pending SIGNED-event buffer, POSTs it to `ingest-events`, and writes an
 * UNSIGNED `ack` back so the station can drop buffered events ≤ acked_seq.
 *
 * INTENTIONALLY import-free (no React Native, no supabase): all of this is plain
 * data shaping so Jest can import + unit-test it directly. The RN/network wiring
 * lives in `ble.ts` and consumes these.
 *
 * FIRMWARE-GATED NO-OP: the station buffer-drain + ack characteristics are
 * Phase 0 firmware Task 5 (not built yet). Until then the wiring's buffer reader
 * returns [] / the ack writer is a guarded no-op, so `planGossipDrain` yields []
 * and the whole flow does nothing. The signed-shape gate (`isSignedEvent`) is a
 * second backstop: today's UNSIGNED firmware events would be filtered out anyway.
 */

import type { StationEvent } from '@/lib/ble/protocol';
import type { AckCommand } from '@/lib/ble/protocol';
import { isSignedEvent } from './relay';

/**
 * Sort signed events ascending by `seq` and dedupe so at most one event per seq
 * survives (first-seen wins). Shared by `planGossipDrain` + `coalesceRelayQueue`.
 */
function sortDedupeBySeq(events: StationEvent[]): StationEvent[] {
  const bySeq = new Map<number, StationEvent>();
  for (const e of events) {
    if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * "What to send" planner for a gossip drain. Filters `buffer` to SIGNED events
 * (via `isSignedEvent`) whose `seq` is strictly greater than `lastAckedSeq`
 * (treat null as -Infinity → include all signed), then sorts ascending by seq
 * and dedupes by seq.
 *
 * Returns [] when there's nothing to drain — so the caller can skip the POST
 * + ack entirely. This is the no-op path: today's firmware has no buffer
 * characteristic, so the reader yields [] → [] here.
 */
export function planGossipDrain(
  buffer: unknown[],
  lastAckedSeq: number | null,
): StationEvent[] {
  const floor = lastAckedSeq ?? Number.NEGATIVE_INFINITY;
  const signed = buffer.filter(isSignedEvent).filter((e) => e.seq > floor);
  return sortDedupeBySeq(signed);
}

/**
 * Build the UNSIGNED `ack` command to write back to the station for a finite
 * `ackedSeq`, telling it to drop buffered events ≤ seq. Returns null when there
 * is nothing to ack (null or non-finite acked_seq) so the caller skips the write.
 */
export function buildAckCommand(ackedSeq: number | null): AckCommand | null {
  if (ackedSeq === null || !Number.isFinite(ackedSeq)) return null;
  return { cmd: 'ack', seq: ackedSeq };
}

/**
 * Coalesce a queue of pending signed events (the Task 7 follow-up): dedupe by
 * seq + sort ascending so multiple buffered events become ONE ingest POST
 * instead of a POST per event. Pure — the debounce timer lives in the wiring.
 */
export function coalesceRelayQueue(pending: StationEvent[]): StationEvent[] {
  return sortDedupeBySeq(pending);
}
