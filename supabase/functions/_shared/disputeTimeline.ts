// Pure, Deno-free dispute-timeline merger.
//
// A support operator resolving "I returned it but got charged" needs ONE
// ordered timeline of everything that happened to a reservation:
//   - the physical BLE station events couriered from the device,
//   - the reservation lifecycle audit rows (reservation_events), and
//   - the synthetic money milestones derived from the reservation's own
//     timestamp columns (opened/returned/eligibility/settled/disputed).
//
// This module merges those three sources and sorts them by time. It is the
// in-process mirror of the SQL `op_dispute_timeline` operator function: the
// SQL version is what ops read in Supabase Studio; this is what edge functions
// (and Jest) use. Pure + total: tolerates empty / unsorted / partial input and
// a null ble_session_id, and never throws.

export type TimelineSource = "reservation" | "station" | "deposit";

export type TimelineEntry = {
  at: string;
  source: TimelineSource;
  kind: string;
  detail?: Record<string, unknown>;
};

type Reservation = {
  ble_session_id: string | null;
  opened_at: string | null;
  returned_at: string | null;
  release_eligible_at: string | null;
  penalty_eligible_at: string | null;
  reversal_eligible_at: string | null;
  settled_at: string | null;
  disputed_at: string | null;
  deposit_state: string;
};

type ReservationEvent = {
  kind: string;
  payload?: unknown;
  at: string;
};

type StationEvent = {
  event: string;
  gate?: number;
  session_id?: string | null;
  wall_ts?: number;
  received_at: string;
  seq?: number;
};

// Coerce an unknown payload into the TimelineEntry.detail shape (an object).
// Non-object payloads (null/scalar/array) are wrapped under { value } so the
// function stays total and `detail` is always a plain record when present.
function asDetail(payload: unknown): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

// Stable, total time key. A missing/unparseable `at` sorts to the very end
// (treated as +Infinity) rather than throwing or corrupting the order.
function timeKey(at: string): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function buildDisputeTimeline(
  reservation: Reservation,
  reservationEvents: ReadonlyArray<ReservationEvent>,
  stationEvents: ReadonlyArray<StationEvent>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // 1. reservation-source: one entry per reservation_events row.
  for (const ev of reservationEvents ?? []) {
    if (!ev) continue;
    entries.push({
      at: ev.at,
      source: "reservation",
      kind: ev.kind,
      detail: asDetail(ev.payload),
    });
  }

  // 2. station-source: only the BLE events for THIS reservation's session.
  // A null ble_session_id matches nothing (=> zero station entries).
  const sessionId = reservation?.ble_session_id ?? null;
  if (sessionId !== null) {
    for (const ev of stationEvents ?? []) {
      if (!ev) continue;
      if (ev.session_id !== sessionId) continue;
      // `at` is the courier-receive time (a real server timestamp); the device
      // wall-clock + seq are carried in detail for the operator.
      const detail: Record<string, unknown> = {};
      if (ev.wall_ts !== undefined) detail.wall_ts = ev.wall_ts;
      if (ev.seq !== undefined) detail.seq = ev.seq;
      if (ev.gate !== undefined) detail.gate = ev.gate;
      entries.push({
        at: ev.received_at,
        source: "station",
        kind: ev.event,
        detail,
      });
    }
  }

  // 3. deposit-source: a synthetic milestone per NON-NULL timestamp column.
  const milestones: Array<[string | null, string]> = [
    [reservation?.opened_at ?? null, "gate_opened_at"],
    [reservation?.returned_at ?? null, "returned_at"],
    [reservation?.release_eligible_at ?? null, "release_eligible"],
    [reservation?.penalty_eligible_at ?? null, "penalty_eligible"],
    [reservation?.reversal_eligible_at ?? null, "reversal_eligible"],
    [reservation?.settled_at ?? null, `settled(${reservation?.deposit_state})`],
    [reservation?.disputed_at ?? null, "disputed"],
  ];
  for (const [ts, kind] of milestones) {
    if (ts === null || ts === undefined) continue;
    entries.push({ at: ts, source: "deposit", kind });
  }

  // Merge + sort ascending by time. Insertion order above is reservation, then
  // station, then deposit; Array.prototype.sort is stable in modern engines, so
  // ties preserve that source ordering. We also map to indices to make the
  // stability explicit and engine-independent.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ka = timeKey(a.entry.at);
      const kb = timeKey(b.entry.at);
      if (ka !== kb) return ka - kb;
      return a.index - b.index; // stable tie-break: original insertion order
    })
    .map(({ entry }) => entry);
}
