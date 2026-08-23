// INTEGRATION test for the EXTRACTED pure ingest orchestration (Step A/B/C).
//
// This is the EXECUTABLE PROOF for Phase 1 Task 6: the Deno `index.ts`
// orchestration was moved verbatim (in behavior) into the Deno-free
// `process.ts`, so Jest can drive the WHOLE loop — sign real events, verify them
// with the REAL Node `verifyEventSig`, durably "store" them, reconcile, and
// advance the acked cursor — against in-memory fakes.
//
// It locks the durability bug fix (scenario #6): a thrown reconcile must NOT be
// masked by the (station_id,seq) dedupe gate; it stays unreconciled, is retried
// on the next call, and acked_seq must NEVER pass the unreconciled gap.
//
// The fakes extend the FakeStore pattern from reconcile.test.ts and add a
// station_events Map (keyed by `${stationId}:${seq}`) for dedupe + reconciled_at,
// plus a station cursor — mirroring SupabaseReconcileStore + EventQueueStore.

import { createHmac } from "node:crypto";
import { verifyEventSig } from "./eventVerify";
import { eventSigningPayload } from "../ble/protocol";
import {
  processIngest,
  type EventQueueStore,
  type UnreconciledRow,
} from "../../supabase/functions/ingest-events/process";
import {
  type ReconcileStore,
  type Reservation,
  type IngestEvent,
} from "../../supabase/functions/ingest-events/reconcile";

// Fixed 64-hex (32-byte) station secret — same as eventVerify.test.ts. The HMAC
// key is the hex-DECODED raw bytes (matching firmware + blesign.ts).
const SECRET_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const STATION = "DEV-001";

// Sign an event exactly like the firmware: HMAC-SHA256 over eventSigningPayload
// with the hex-decoded key, sig over the payload with sig:"". Returns the event
// with its real sig filled in (same helper shape as eventVerify.test.ts::sign).
// Returns `sig` narrowed to string: IngestEvent declares no `sig` field, so it
// falls through the `[k: string]: unknown` index signature and callers that
// inspect the signature (the tamper tests) would otherwise get `unknown`.
function sign(
  e: Record<string, unknown>,
  secretHex: string = SECRET_HEX,
): IngestEvent & { sig: string } {
  const { sig: _drop, ...rest } = e;
  const full = { ...rest, sig: "" };
  return {
    ...rest,
    sig: createHmac("sha256", Buffer.from(secretHex, "hex"))
      .update(eventSigningPayload(full as any))
      .digest("hex"),
  } as unknown as IngestEvent & { sig: string };
}

// ---- In-memory store + durable queue + station cursor -------------------
// Implements BOTH the domain ReconcileStore port AND the EventQueueStore
// (durable station_events queue). A station_events Map keyed by
// `${stationId}:${seq}` gives dedupe + reconciled_at, exactly like the DB.

type StoredEvent = {
  id: number;
  stationId: string;
  seq: number;
  raw: Record<string, unknown>;
  reconciledAt: string | null;
};

type AppendedEvent = {
  reservationId: string;
  kind: string;
  payload: Record<string, unknown>;
};

class FakeBackend implements ReconcileStore, EventQueueStore {
  reservations = new Map<string, Reservation>();
  appended: AppendedEvent[] = [];
  stationUpdates: Array<{ stationId: string; fields: Record<string, unknown> }> = [];

  // station_events durable queue, keyed by `${stationId}:${seq}` for dedupe.
  events = new Map<string, StoredEvent>();
  private nextId = 1;

  // station cursor (acked_seq / last_event_seq / last_seen_at).
  cursors = new Map<string, { acked_seq: number; last_event_seq: number; last_seen_at: string }>();

  // Inject a one-shot failure into updateReservation (durability/retry scenario).
  failUpdateOnce = false;

  seedReservation(r: Reservation) {
    this.reservations.set(r.id, { ...r });
  }
  seedCursor(stationId: string, acked: number) {
    this.cursors.set(stationId, { acked_seq: acked, last_event_seq: acked, last_seen_at: "" });
  }

  // --- ReconcileStore (pure domain port) ---------------------------------
  async getReservationBySession(sessionId: string): Promise<Reservation | null> {
    for (const r of this.reservations.values()) {
      if (r.ble_session_id === sessionId) return { ...r };
    }
    return null;
  }
  async updateReservation(id: string, fields: Partial<Reservation>): Promise<void> {
    if (this.failUpdateOnce) {
      this.failUpdateOnce = false;
      throw new Error("injected updateReservation failure");
    }
    const cur = this.reservations.get(id);
    if (!cur) throw new Error(`no reservation ${id}`);
    this.reservations.set(id, { ...cur, ...fields });
  }
  async appendReservationEvent(
    reservationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.appended.push({ reservationId, kind, payload });
  }
  async updateStation(stationId: string, fields: Record<string, unknown>): Promise<void> {
    this.stationUpdates.push({ stationId, fields });
  }

  // --- EventQueueStore (durable station_events queue) --------------------
  async upsertStationEvent(row: {
    stationId: string;
    seq: number;
    event: IngestEvent;
  }): Promise<{ inserted: boolean }> {
    const key = `${row.stationId}:${row.seq}`;
    if (this.events.has(key)) return { inserted: false }; // dedupe hit
    this.events.set(key, {
      id: this.nextId++,
      stationId: row.stationId,
      seq: row.seq,
      raw: row.event as Record<string, unknown>,
      reconciledAt: null,
    });
    return { inserted: true };
  }
  async getUnreconciledEvents(stationId: string): Promise<UnreconciledRow[]> {
    return [...this.events.values()]
      .filter((e) => e.stationId === stationId && e.reconciledAt === null)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ id: e.id, seq: e.seq, raw: e.raw }));
  }
  async markReconciled(eventId: number, nowISO: string): Promise<void> {
    for (const e of this.events.values()) {
      if (e.id === eventId) {
        e.reconciledAt = nowISO;
        return;
      }
    }
    throw new Error(`no event ${eventId}`);
  }
  async getReconciledSeqs(stationId: string): Promise<number[]> {
    return [...this.events.values()]
      .filter((e) => e.stationId === stationId && e.reconciledAt !== null)
      .map((e) => e.seq);
  }

  // --- station cursor ----------------------------------------------------
  async getStationAckedSeq(stationId: string): Promise<number> {
    return this.cursors.get(stationId)?.acked_seq ?? 0;
  }
  async updateStationCursor(
    stationId: string,
    fields: { acked_seq: number; last_event_seq: number; last_seen_at: string },
  ): Promise<void> {
    this.cursors.set(stationId, { ...fields });
  }

  // --- test helpers ------------------------------------------------------
  res(id: string) {
    return this.reservations.get(id)!;
  }
  appendsOf(kind: string) {
    return this.appended.filter((a) => a.kind === kind);
  }
  storedSeqs() {
    return [...this.events.values()].map((e) => e.seq).sort((a, b) => a - b);
  }
  reconciledAtOf(stationId: string, seq: number) {
    return this.events.get(`${stationId}:${seq}`)?.reconciledAt ?? null;
  }
}

const baseReservation = (over: Partial<Reservation> & { id: string }): Reservation => ({
  status: "active",
  ble_session_id: null,
  opened_at: null,
  returned_at: null,
  release_eligible_at: null,
  penalty_eligible_at: null,
  reversal_eligible_at: null,
  ...over,
});

// Build the deps object wired to a FakeBackend + the REAL Node verifyEventSig.
// `now` is fixed so we can assert exact timestamps.
const NOW = "2026-06-05T12:00:00.000Z";
function makeDeps(backend: FakeBackend, now: string = NOW) {
  return {
    verifyEventSig: (ev: IngestEvent, secretHex: string) =>
      verifyEventSig(ev as any, secretHex),
    store: backend,
    queue: backend,
    getStationAckedSeq: (id: string) => backend.getStationAckedSeq(id),
    updateStationCursor: (id: string, f: any) => backend.updateStationCursor(id, f),
    now: () => now,
  };
}

describe("processIngest — full loop integration (signed → verified → reconciled → acked)", () => {
  // 1. HAPPY PATH ----------------------------------------------------------
  it("happy path: gate_opened(1) then gate_closed(2) → opened_at + returned_at + release_eligible_at; reconciled=2; acked_seq=2", async () => {
    const b = new FakeBackend();
    b.seedReservation(
      baseReservation({ id: "r1", status: "consumed", ble_session_id: "sim-1" }),
    );
    b.seedCursor(STATION, 0);

    const events = [
      sign({ event: "gate_opened", gate: 1, session_id: "sim-1", seq: 1, ts: 100 }),
      sign({ event: "gate_closed", gate: 1, session_id: "sim-1", seq: 2, ts: 200 }),
    ];

    const out = await processIngest(makeDeps(b), { stationId: STATION, secretHex: SECRET_HEX, events });

    expect(out).toEqual({ accepted: 2, deduped: 0, rejected: 0, reconciled: 2, acked_seq: 2 });
    expect(b.res("r1").opened_at).toBe(NOW);
    expect(b.res("r1").returned_at).toBe(NOW);
    expect(b.res("r1").release_eligible_at).toBe(NOW);
    expect(b.cursors.get(STATION)!.acked_seq).toBe(2);
  });

  // 2. REPLAY / DEDUPE -----------------------------------------------------
  it("replay/dedupe: re-ingest same batch → deduped=2 accepted=0, no new appends, state unchanged, acked_seq still 2", async () => {
    const b = new FakeBackend();
    b.seedReservation(
      baseReservation({ id: "r1", status: "consumed", ble_session_id: "sim-1" }),
    );
    b.seedCursor(STATION, 0);
    const events = [
      sign({ event: "gate_opened", gate: 1, session_id: "sim-1", seq: 1, ts: 100 }),
      sign({ event: "gate_closed", gate: 1, session_id: "sim-1", seq: 2, ts: 200 }),
    ];
    const deps = makeDeps(b);

    await processIngest(deps, { stationId: STATION, secretHex: SECRET_HEX, events });
    const appendsAfterFirst = b.appended.length;
    const openedAt = b.res("r1").opened_at;
    const returnedAt = b.res("r1").returned_at;

    // Re-ingest the EXACT same signed batch.
    const out = await processIngest(deps, { stationId: STATION, secretHex: SECRET_HEX, events });

    expect(out.accepted).toBe(0);
    expect(out.deduped).toBe(2);
    expect(out.rejected).toBe(0);
    // Nothing left unreconciled, so Step B reconciled nothing new this call.
    expect(out.reconciled).toBe(0);
    expect(out.acked_seq).toBe(2);
    // No new reservation_events appended; reservation state unchanged.
    expect(b.appended.length).toBe(appendsAfterFirst);
    expect(b.res("r1").opened_at).toBe(openedAt);
    expect(b.res("r1").returned_at).toBe(returnedAt);
  });

  // 3. OUT-OF-ORDER --------------------------------------------------------
  it("out-of-order: gate_closed(5) before gate_opened(4) in separate calls → returned_at first, opened_at backfilled; acked advances contiguously", async () => {
    const b = new FakeBackend();
    b.seedReservation(baseReservation({ id: "r1", status: "consumed", ble_session_id: "oo-1" }));
    b.seedCursor(STATION, 3); // seqs 1-3 already acked previously

    // gate_closed(5) arrives first.
    const out1 = await processIngest(makeDeps(b, "2026-06-05T12:05:00.000Z"), {
      stationId: STATION,
      secretHex: SECRET_HEX,
      events: [sign({ event: "gate_closed", gate: 1, session_id: "oo-1", seq: 5, ts: 500 })],
    });
    expect(b.res("r1").returned_at).toBe("2026-06-05T12:05:00.000Z");
    expect(b.res("r1").opened_at).toBeNull();
    // Only seq 5 reconciled; 4 is missing → cursor cannot advance past gap.
    expect(out1.reconciled).toBe(1);
    expect(out1.acked_seq).toBe(3);

    // gate_opened(4) arrives later, backfills opened_at.
    const out2 = await processIngest(makeDeps(b, "2026-06-05T12:04:00.000Z"), {
      stationId: STATION,
      secretHex: SECRET_HEX,
      events: [sign({ event: "gate_opened", gate: 1, session_id: "oo-1", seq: 4, ts: 400 })],
    });
    expect(b.res("r1").opened_at).toBe("2026-06-05T12:04:00.000Z");
    expect(b.res("r1").returned_at).toBe("2026-06-05T12:05:00.000Z");
    // Now 4 and 5 both reconciled, starting acked 3 → contiguous to 5.
    expect(out2.reconciled).toBe(1);
    expect(out2.acked_seq).toBe(5);
  });

  // 4. TAMPERED SIG --------------------------------------------------------
  it("tampered sig: flipped char on gate_closed → rejected=1, NOT stored/reconciled, reservation untouched", async () => {
    const b = new FakeBackend();
    b.seedReservation(baseReservation({ id: "r1", status: "consumed", ble_session_id: "ts-1" }));
    b.seedCursor(STATION, 0);

    const good = sign({ event: "gate_closed", gate: 1, session_id: "ts-1", seq: 7, ts: 700 });
    // Flip the first hex char of the sig.
    const flipped = good.sig[0] === "a" ? "b" : "a";
    const tampered = { ...good, sig: flipped + good.sig.slice(1) } as IngestEvent;

    const out = await processIngest(makeDeps(b), { stationId: STATION, secretHex: SECRET_HEX, events: [tampered] });

    expect(out.rejected).toBe(1);
    expect(out.accepted).toBe(0);
    expect(out.reconciled).toBe(0);
    expect(b.storedSeqs()).toEqual([]); // never stored
    expect(b.res("r1").returned_at).toBeNull(); // reservation untouched
    expect(b.appended).toHaveLength(0);
  });

  // 5. FOREIGN / UNKNOWN SESSION ------------------------------------------
  it("foreign session: signed gate_closed for a session with no reservation → stored + reconciled (no_reservation), no reservation mutated, acked still advances", async () => {
    const b = new FakeBackend();
    // A reservation exists but for a DIFFERENT session.
    b.seedReservation(baseReservation({ id: "r1", status: "consumed", ble_session_id: "mine" }));
    b.seedCursor(STATION, 0);

    const events = [sign({ event: "gate_closed", gate: 1, session_id: "ghost", seq: 1, ts: 100 })];
    const out = await processIngest(makeDeps(b), { stationId: STATION, secretHex: SECRET_HEX, events });

    expect(out.accepted).toBe(1);
    expect(out.reconciled).toBe(1); // valid signed event → reconciled (effect no_reservation)
    expect(out.acked_seq).toBe(1); // cursor still advances over the reconciled seq
    expect(b.reconciledAtOf(STATION, 1)).toBe(NOW);
    expect(b.res("r1").returned_at).toBeNull(); // no reservation mutated
    expect(b.appended).toHaveLength(0);
  });

  // 6. DURABILITY / RETRY (locks the fixed bug) ---------------------------
  it("durability/retry: a thrown reconcile leaves the event unreconciled, acked_seq does NOT pass the gap; re-send (dedupe hit) reconciles it and acked advances", async () => {
    const b = new FakeBackend();
    b.seedReservation(baseReservation({ id: "r1", status: "consumed", ble_session_id: "dur-1" }));
    b.seedCursor(STATION, 0);

    const closed = sign({ event: "gate_closed", gate: 1, session_id: "dur-1", seq: 2, ts: 200 });

    // First call: send gate_closed (seq 2) ALONE with the store armed to throw on
    // its very first updateReservation, so this event's reconcile fails.
    b.failUpdateOnce = true;
    const out1 = await processIngest(makeDeps(b), {
      stationId: STATION,
      secretHex: SECRET_HEX,
      events: [closed],
    });

    // Event IS durably stored, but reconcile threw → reconciled_at NULL, not counted.
    expect(b.storedSeqs()).toEqual([2]);
    expect(b.reconciledAtOf(STATION, 2)).toBeNull();
    expect(out1.accepted).toBe(1);
    expect(out1.reconciled).toBe(0);
    // CRITICAL: acked_seq did NOT advance past the unreconciled gap (seq 2 stored,
    // unreconciled; nothing reconciled → cursor stays at 0).
    expect(out1.acked_seq).toBe(0);
    expect(b.res("r1").returned_at).toBeNull(); // failed update left no mutation

    // "Re-send" the SAME event — it's now a dedupe hit (accepted=0,deduped=1),
    // but Step B re-drives the still-NULL row. Store no longer throws.
    expect(b.failUpdateOnce).toBe(false); // one-shot already consumed
    const out2 = await processIngest(makeDeps(b), {
      stationId: STATION,
      secretHex: SECRET_HEX,
      events: [closed],
    });

    expect(out2.accepted).toBe(0);
    expect(out2.deduped).toBe(1); // dedupe gate hit...
    expect(out2.reconciled).toBe(1); // ...but the retry path still reconciled it
    expect(b.reconciledAtOf(STATION, 2)).toBe(NOW);
    expect(b.res("r1").returned_at).toBe(NOW); // now applied
    expect(b.res("r1").release_eligible_at).toBe(NOW);
    // seq 1 was never sent, so contiguous-from-0 still stops before seq 2's gap
    // at seq 1... but here only seq 2 is reconciled and acked starts at 0, so the
    // contiguous walk from 0 needs seq 1 (absent) → acked stays 0. This proves
    // acked never jumps over the missing seq 1 either.
    expect(out2.acked_seq).toBe(0);
  });

  // 6b. DURABILITY follow-up: once the gap (seq 1) is filled, acked jumps to 2 ---
  it("durability/retry continued: after seq 1 also reconciles, acked advances contiguously to 2", async () => {
    const b = new FakeBackend();
    b.seedReservation(baseReservation({ id: "r1", status: "consumed", ble_session_id: "dur-2" }));
    b.seedCursor(STATION, 0);
    const opened = sign({ event: "gate_opened", gate: 1, session_id: "dur-2", seq: 1, ts: 100 });
    const closed = sign({ event: "gate_closed", gate: 1, session_id: "dur-2", seq: 2, ts: 200 });

    // closed(2) reconcile throws on first attempt.
    b.failUpdateOnce = true;
    await processIngest(makeDeps(b), { stationId: STATION, secretHex: SECRET_HEX, events: [closed] });
    expect(b.reconciledAtOf(STATION, 2)).toBeNull();

    // Now send opened(1) AND re-send closed(2): seq 1 reconciles, seq 2 retried.
    const out = await processIngest(makeDeps(b), {
      stationId: STATION,
      secretHex: SECRET_HEX,
      events: [opened, closed],
    });
    expect(out.reconciled).toBe(2); // seq1 (new) + seq2 (retried)
    expect(b.reconciledAtOf(STATION, 1)).toBe(NOW);
    expect(b.reconciledAtOf(STATION, 2)).toBe(NOW);
    expect(out.acked_seq).toBe(2); // contiguous 1,2 from acked 0
  });

  // 7. LATE RETURN AFTER PENALTY ------------------------------------------
  it("late return after penalty: penalty_eligible_at set → gate_closed sets returned_at + reversal_eligible_at + appends late_return_after_penalty", async () => {
    const b = new FakeBackend();
    b.seedReservation(
      baseReservation({
        id: "r1",
        status: "consumed",
        ble_session_id: "late-1",
        opened_at: "2026-06-05T10:00:00.000Z",
        penalty_eligible_at: "2026-06-05T11:00:00.000Z",
      }),
    );
    b.seedCursor(STATION, 0);

    const events = [sign({ event: "gate_closed", gate: 1, session_id: "late-1", seq: 1, ts: 100 })];
    const out = await processIngest(makeDeps(b), { stationId: STATION, secretHex: SECRET_HEX, events });

    expect(out.reconciled).toBe(1);
    expect(out.acked_seq).toBe(1);
    expect(b.res("r1").returned_at).toBe(NOW);
    expect(b.res("r1").release_eligible_at).toBe(NOW);
    expect(b.res("r1").reversal_eligible_at).toBe(NOW);
    expect(b.appendsOf("gate_closed")).toHaveLength(1);
    expect(b.appendsOf("late_return_after_penalty")).toHaveLength(1);
  });
});
