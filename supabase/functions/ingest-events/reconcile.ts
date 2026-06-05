// PURE server-side reconcile core — Deno-free, Supabase-free.
//
// This module holds ALL the domain logic for applying ONE already-verified,
// already-deduped station event to the reservation lifecycle. It deliberately
// imports nothing from Deno or supabase-js and contains no remote `esm.sh`
// imports, so Jest can import it directly (proven pattern: `_shared/canonical.ts`
// and `sign-unlock/link-session.ts` are both Jest-tested the same way).
//
// All I/O goes through the `ReconcileStore` PORT below; the Deno `index.ts`
// wires a Supabase-backed implementation, while Jest wires an in-memory fake.
//
// MONEY SEAM: this core NEVER calls iyzico or moves money. It only sets the
// `*_eligible_at` flags + writes audit rows. Phase 2 will read those flags and
// actually capture/release/reverse holds. See the `// PHASE 2:` markers in
// index.ts where the HTTP shell would later trigger settlement.

// Reservation shape this core reads/writes. Mirrors the reconciliation columns
// added in migration 20260605120000 (plus the `id`/`status` that already exist).
export type Reservation = {
  id: string;
  status: string;
  ble_session_id: string | null;
  opened_at: string | null;
  returned_at: string | null;
  release_eligible_at: string | null;
  penalty_eligible_at: string | null;
  reversal_eligible_at: string | null;
};

// The PORT: the minimal async data-access surface the reconcile logic needs.
// Implemented by SupabaseReconcileStore (Deno/prod) and FakeStore (Jest).
export interface ReconcileStore {
  getReservationBySession(sessionId: string): Promise<Reservation | null>;
  updateReservation(id: string, fields: Partial<Reservation>): Promise<void>;
  appendReservationEvent(
    reservationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  updateStation(stationId: string, fields: Record<string, unknown>): Promise<void>;
}

// Minimal event shape this core consumes. The Deno shell passes the verified
// StationEvent (from lib/ble/protocol.ts); we read only the fields we need and
// stay structurally typed so this module needs no protocol import.
export type IngestEvent = {
  event: string;
  session_id?: string;
  gate?: number;
  mv?: number;
  seq?: number;
  ts?: number;
  [k: string]: unknown;
};

export type ReconcileResult = { kind: string; effect: string };

// Apply ONE verified, deduped event's domain effects. `nowISO` is the server's
// trusted clock (device wall_ts is non-authoritative — see protocol.ts), used
// for every timestamp we persist. Returns a small result for response counts /
// logging. Throwing is reserved for genuine store/IO failures.
export async function reconcileEvent(
  store: ReconcileStore,
  stationId: string,
  ev: IngestEvent,
  nowISO: string,
): Promise<ReconcileResult> {
  switch (ev.event) {
    case "gate_opened":
      return gateOpened(store, ev, nowISO);
    case "gate_closed":
      return gateClosed(store, ev, nowISO);
    case "unlock_timeout":
      return unlockTimeout(store, ev, nowISO);
    case "return_timeout":
      return sessionNote(store, ev, "return_timeout", nowISO);
    case "ball_overdue":
      return sessionNote(store, ev, "ball_overdue", nowISO);
    case "battery_low":
    case "battery_critical":
      return battery(store, stationId, ev, nowISO);
    case "boot":
      return boot(store, stationId, nowISO);
    default:
      // Unknown kinds are verified+stored upstream but have no domain effect.
      return { kind: ev.event, effect: "ignored" };
  }
}

async function gateOpened(
  store: ReconcileStore,
  ev: IngestEvent,
  nowISO: string,
): Promise<ReconcileResult> {
  const r = await findBySession(store, ev);
  if (!r) return { kind: "gate_opened", effect: "no_reservation" };
  // Idempotent: only the FIRST gate_opened backfills opened_at + audits. Works
  // even out-of-order (gate_closed may already have set returned_at).
  if (r.opened_at) return { kind: "gate_opened", effect: "already_opened" };

  await store.updateReservation(r.id, { opened_at: nowISO });
  await store.appendReservationEvent(r.id, "gate_opened", {
    session_id: ev.session_id ?? null,
    gate: ev.gate ?? null,
    seq: ev.seq ?? null,
  });
  return { kind: "gate_opened", effect: "opened" };
}

async function gateClosed(
  store: ReconcileStore,
  ev: IngestEvent,
  nowISO: string,
): Promise<ReconcileResult> {
  const r = await findBySession(store, ev);
  if (!r) return { kind: "gate_closed", effect: "no_reservation" };
  // Idempotent replay: a gate_closed for an already-returned reservation is a
  // no-op (the same physical event couriered late, or a genuine duplicate that
  // slipped past seq-dedupe across a station_id mismatch).
  if (r.returned_at) return { kind: "gate_closed", effect: "already_returned" };

  const fields: Partial<Reservation> = {
    returned_at: nowISO,
    // release_eligible_at: hold can now be released — PHASE 2 acts on this.
    release_eligible_at: nowISO,
  };

  // Late return: the penalty window already elapsed (penalty_eligible_at was
  // set, presumably by a sweep). The ball/gate DID come back, so the penalty is
  // reversible — flag reversal_eligible_at and audit the late return. We ALSO
  // clear penalty_eligible_at in the SAME update: reversal_eligible_at tells
  // Phase 2 "refund any penalty already captured", and clearing
  // penalty_eligible_at prevents Phase 2 from capturing a penalty that hasn't
  // been processed yet. Together they make the returned-ball-still-penalized
  // state impossible regardless of Phase-2 read order.
  const late = r.penalty_eligible_at != null;
  if (late) {
    fields.reversal_eligible_at = nowISO;
    fields.penalty_eligible_at = null;
  }

  await store.updateReservation(r.id, fields);
  await store.appendReservationEvent(r.id, "gate_closed", {
    session_id: ev.session_id ?? null,
    gate: ev.gate ?? null,
    seq: ev.seq ?? null,
  });
  if (late) {
    await store.appendReservationEvent(r.id, "late_return_after_penalty", {
      session_id: ev.session_id ?? null,
      penalty_eligible_at: r.penalty_eligible_at,
    });
    return { kind: "gate_closed", effect: "returned_late" };
  }
  return { kind: "gate_closed", effect: "returned" };
}

async function unlockTimeout(
  store: ReconcileStore,
  ev: IngestEvent,
  nowISO: string,
): Promise<ReconcileResult> {
  const r = await findBySession(store, ev);
  if (!r) return { kind: "unlock_timeout", effect: "no_reservation" };
  // The gate never opened before the unlock window lapsed: void path, no
  // dispense. Make the hold release-eligible (PHASE 2 releases it — no capture).
  await store.updateReservation(r.id, { release_eligible_at: nowISO });
  await store.appendReservationEvent(r.id, "unlock_timeout", {
    session_id: ev.session_id ?? null,
    seq: ev.seq ?? null,
  });
  return { kind: "unlock_timeout", effect: "release_eligible" };
}

// return_timeout / ball_overdue: append an audit row but DON'T close the
// session — the session stays open so a later gate_closed can still reconcile.
async function sessionNote(
  store: ReconcileStore,
  ev: IngestEvent,
  kind: string,
  _nowISO: string,
): Promise<ReconcileResult> {
  const r = await findBySession(store, ev);
  if (!r) return { kind, effect: "no_reservation" };
  await store.appendReservationEvent(r.id, kind, {
    session_id: ev.session_id ?? null,
    seq: ev.seq ?? null,
  });
  return { kind, effect: "noted" };
}

async function battery(
  store: ReconcileStore,
  stationId: string,
  ev: IngestEvent,
  nowISO: string,
): Promise<ReconcileResult> {
  // Telemetry only — no reservation_events. battery_pct is left to the DB/null
  // for now (we don't have the per-station voltage→percent curve here).
  await store.updateStation(stationId, {
    battery_mv: ev.mv ?? null,
    battery_pct: null,
    last_seen_at: nowISO,
  });
  return { kind: ev.event, effect: "battery" };
}

async function boot(
  store: ReconcileStore,
  stationId: string,
  nowISO: string,
): Promise<ReconcileResult> {
  await store.updateStation(stationId, { last_seen_at: nowISO });
  return { kind: "boot", effect: "boot" };
}

async function findBySession(
  store: ReconcileStore,
  ev: IngestEvent,
): Promise<Reservation | null> {
  if (!ev.session_id) return null;
  return store.getReservationBySession(ev.session_id);
}

// PURE: walk from currentAcked+1 upward while each successive integer is present
// in storedSeqs, returning the highest CONTIGUOUS seq. This is the safe cursor a
// station can use to drop buffered events whose seq <= acked_seq: we never ack
// past a gap, so no un-acked event is silently dropped.
//
//   (0,[1,2,3]) => 3   (0,[1,2,4]) => 2
//   (0,[2,3])   => 0   (3,[4,5,7]) => 5
export function computeAckedSeq(currentAcked: number, storedSeqs: number[]): number {
  const present = new Set(storedSeqs);
  let acked = currentAcked;
  while (present.has(acked + 1)) {
    acked += 1;
  }
  return acked;
}
