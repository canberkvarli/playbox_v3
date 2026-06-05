// Unit tests for the PURE server-side reconcile core.
//
// Imports the Deno-free module directly (same Jest-can-import pattern as
// canonical-parity.test.ts / link-session.test.ts). reconcile.ts MUST NOT touch
// Supabase or Deno — only the in-memory fake ReconcileStore below.
//
// These tests assert REAL state changes (reservation field mutations + appended
// audit rows + station updates), not just the returned effect string.
import {
  reconcileEvent,
  computeAckedSeq,
  type ReconcileStore,
  type Reservation,
} from "../../supabase/functions/ingest-events/reconcile";

const NOW = "2026-06-05T12:00:00.000Z";

type AppendedEvent = {
  reservationId: string;
  kind: string;
  payload: Record<string, unknown>;
};

// In-memory ReconcileStore: Maps for reservations + appended events + station
// updates. Mirrors what SupabaseReconcileStore does against the DB.
class FakeStore implements ReconcileStore {
  reservations = new Map<string, Reservation>();
  appended: AppendedEvent[] = [];
  stationUpdates: Array<{ stationId: string; fields: Record<string, unknown> }> = [];

  seed(r: Reservation) {
    this.reservations.set(r.id, { ...r });
  }

  async getReservationBySession(sessionId: string): Promise<Reservation | null> {
    for (const r of this.reservations.values()) {
      if (r.ble_session_id === sessionId) return { ...r };
    }
    return null;
  }

  async updateReservation(id: string, fields: Partial<Reservation>): Promise<void> {
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

  // test helpers
  appendsOf(kind: string) {
    return this.appended.filter((a) => a.kind === kind);
  }
  res(id: string) {
    return this.reservations.get(id)!;
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

const ev = (over: Record<string, unknown>) =>
  ({ seq: 1, ts: 1700000000, sig: "deadbeef", ...over } as any);

describe("reconcileEvent — gate_opened", () => {
  it("sets opened_at and appends gate_opened once", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_opened", gate: 1, session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("opened");
    expect(store.res("r1").opened_at).toBe(NOW);
    expect(store.appendsOf("gate_opened")).toHaveLength(1);
  });

  it("does not re-append when opened_at already set (idempotent replay)", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1", opened_at: "2026-06-05T11:00:00.000Z" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_opened", gate: 1, session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("already_opened");
    expect(store.res("r1").opened_at).toBe("2026-06-05T11:00:00.000Z");
    expect(store.appendsOf("gate_opened")).toHaveLength(0);
  });

  it("no_reservation when session unknown", async () => {
    const store = new FakeStore();
    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_opened", gate: 1, session_id: "ghost" }),
      NOW,
    );
    expect(result.effect).toBe("no_reservation");
    expect(store.appended).toHaveLength(0);
  });
});

describe("reconcileEvent — gate_closed", () => {
  it("sets returned_at + release_eligible_at and appends gate_closed", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1", opened_at: "2026-06-05T11:00:00.000Z" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_closed", gate: 1, session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("returned");
    expect(store.res("r1").returned_at).toBe(NOW);
    expect(store.res("r1").release_eligible_at).toBe(NOW);
    expect(store.appendsOf("gate_closed")).toHaveLength(1);
    expect(store.appendsOf("late_return_after_penalty")).toHaveLength(0);
  });

  it("replayed gate_closed is idempotent no-op (already_returned)", async () => {
    const store = new FakeStore();
    store.seed(
      baseReservation({
        id: "r1",
        ble_session_id: "sess-1",
        returned_at: "2026-06-05T11:30:00.000Z",
        release_eligible_at: "2026-06-05T11:30:00.000Z",
      }),
    );

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_closed", gate: 1, session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("already_returned");
    expect(store.res("r1").returned_at).toBe("2026-06-05T11:30:00.000Z");
    expect(store.appendsOf("gate_closed")).toHaveLength(0);
  });

  it("when penalty_eligible_at set, also sets reversal_eligible_at + appends late_return_after_penalty", async () => {
    const store = new FakeStore();
    store.seed(
      baseReservation({
        id: "r1",
        ble_session_id: "sess-1",
        opened_at: "2026-06-05T10:00:00.000Z",
        penalty_eligible_at: "2026-06-05T11:00:00.000Z",
      }),
    );

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_closed", gate: 1, session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("returned_late");
    expect(store.res("r1").returned_at).toBe(NOW);
    expect(store.res("r1").release_eligible_at).toBe(NOW);
    expect(store.res("r1").reversal_eligible_at).toBe(NOW);
    // penalty_eligible_at MUST be cleared so Phase 2 cannot capture a penalty on
    // a ball that has been returned (returned-ball-still-penalized is impossible).
    expect(store.res("r1").penalty_eligible_at).toBeNull();
    expect(store.appendsOf("gate_closed")).toHaveLength(1);
    expect(store.appendsOf("late_return_after_penalty")).toHaveLength(1);
  });

  it("no_reservation for unknown session — no reservation mutated", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "gate_closed", gate: 1, session_id: "ghost" }),
      NOW,
    );

    expect(result.effect).toBe("no_reservation");
    expect(store.res("r1").returned_at).toBeNull();
    expect(store.appended).toHaveLength(0);
  });
});

describe("reconcileEvent — out-of-order delivery", () => {
  it("gate_closed (seq5) before gate_opened (seq4): returned_at set, then gate_opened backfills opened_at", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1" }));

    // gate_closed arrives first (higher seq processed earlier)
    const closed = await reconcileEvent(
      store,
      "ST-1",
      ev({ seq: 5, event: "gate_closed", gate: 1, session_id: "sess-1" }),
      "2026-06-05T12:05:00.000Z",
    );
    expect(closed.effect).toBe("returned");
    expect(store.res("r1").returned_at).toBe("2026-06-05T12:05:00.000Z");
    expect(store.res("r1").opened_at).toBeNull();

    // gate_opened arrives later, backfills opened_at without clobbering return
    const opened = await reconcileEvent(
      store,
      "ST-1",
      ev({ seq: 4, event: "gate_opened", gate: 1, session_id: "sess-1" }),
      "2026-06-05T12:04:00.000Z",
    );
    expect(opened.effect).toBe("opened");
    expect(store.res("r1").opened_at).toBe("2026-06-05T12:04:00.000Z");
    expect(store.res("r1").returned_at).toBe("2026-06-05T12:05:00.000Z");
  });
});

describe("reconcileEvent — unlock_timeout / return_timeout / ball_overdue", () => {
  it("unlock_timeout sets release_eligible_at and appends", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "unlock_timeout", session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("release_eligible");
    expect(store.res("r1").release_eligible_at).toBe(NOW);
    expect(store.appendsOf("unlock_timeout")).toHaveLength(1);
  });

  it("return_timeout appends but keeps session open (no field change)", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1", opened_at: NOW }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "return_timeout", session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("noted");
    expect(store.res("r1").returned_at).toBeNull();
    expect(store.res("r1").release_eligible_at).toBeNull();
    expect(store.appendsOf("return_timeout")).toHaveLength(1);
  });

  it("ball_overdue appends audit row", async () => {
    const store = new FakeStore();
    store.seed(baseReservation({ id: "r1", ble_session_id: "sess-1" }));

    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "ball_overdue", session_id: "sess-1" }),
      NOW,
    );

    expect(result.effect).toBe("noted");
    expect(store.appendsOf("ball_overdue")).toHaveLength(1);
  });

  it("unlock_timeout for unknown session is a no_reservation no-op", async () => {
    const store = new FakeStore();
    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "unlock_timeout", session_id: "ghost" }),
      NOW,
    );
    expect(result.effect).toBe("no_reservation");
    expect(store.appended).toHaveLength(0);
  });
});

describe("reconcileEvent — station telemetry (battery / boot)", () => {
  it("battery_low updates station battery_mv + last_seen_at, writes NO reservation_events", async () => {
    const store = new FakeStore();
    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "battery_low", mv: 11900 }),
      NOW,
    );

    expect(result.effect).toBe("battery");
    expect(store.appended).toHaveLength(0);
    expect(store.stationUpdates).toHaveLength(1);
    expect(store.stationUpdates[0].stationId).toBe("ST-1");
    expect(store.stationUpdates[0].fields.battery_mv).toBe(11900);
    expect(store.stationUpdates[0].fields.last_seen_at).toBe(NOW);
  });

  it("battery_critical updates station battery_mv + last_seen_at, no reservation_events", async () => {
    const store = new FakeStore();
    const result = await reconcileEvent(
      store,
      "ST-1",
      ev({ event: "battery_critical", mv: 10500 }),
      NOW,
    );

    expect(result.effect).toBe("battery");
    expect(store.appended).toHaveLength(0);
    expect(store.stationUpdates[0].fields.battery_mv).toBe(10500);
  });

  it("boot updates only last_seen_at", async () => {
    const store = new FakeStore();
    const result = await reconcileEvent(store, "ST-1", ev({ event: "boot" }), NOW);

    expect(result.effect).toBe("boot");
    expect(store.appended).toHaveLength(0);
    expect(store.stationUpdates).toHaveLength(1);
    expect(store.stationUpdates[0].fields.last_seen_at).toBe(NOW);
    expect(store.stationUpdates[0].fields.battery_mv).toBeUndefined();
  });
});

describe("computeAckedSeq", () => {
  it("(0,[1,2,3]) => 3 (fully contiguous)", () => {
    expect(computeAckedSeq(0, [1, 2, 3])).toBe(3);
  });
  it("(0,[1,2,4]) => 2 (stops at the gap)", () => {
    expect(computeAckedSeq(0, [1, 2, 4])).toBe(2);
  });
  it("(0,[2,3]) => 0 (missing seq 1 — nothing contiguous from start)", () => {
    expect(computeAckedSeq(0, [2, 3])).toBe(0);
  });
  it("(3,[4,5,7]) => 5 (resumes from currentAcked+1, stops at gap)", () => {
    expect(computeAckedSeq(3, [4, 5, 7])).toBe(5);
  });
  it("(0,[]) => 0 (no stored seqs)", () => {
    expect(computeAckedSeq(0, [])).toBe(0);
  });
  it("(5,[1,2,3]) => 5 (all stored seqs already below acked)", () => {
    expect(computeAckedSeq(5, [1, 2, 3])).toBe(5);
  });
  it("unordered + duplicate stored seqs still walk contiguously", () => {
    expect(computeAckedSeq(0, [3, 1, 2, 2, 5])).toBe(3);
  });

  // Correctness guard for the reconciled_at retry queue: index.ts passes ONLY
  // the RECONCILED seqs here, never the merely-stored ones. If seqs 1 and 2 are
  // reconciled but 3 is stored-but-unreconciled (its reconcile threw and left
  // reconciled_at null), it is NOT in this array, so acked_seq stops at 2 — the
  // courier never drops the un-applied event 3, and event 3 is retried next call.
  it("does NOT advance past an unreconciled gap: reconciled [1,2], 3 stored-unreconciled => 2", () => {
    expect(computeAckedSeq(0, [1, 2])).toBe(2);
  });
});
