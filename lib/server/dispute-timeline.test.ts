// Unit tests for the PURE dispute-timeline merger: buildDisputeTimeline.
//
// A support operator resolving "I returned it but got charged" needs ONE
// ordered timeline of everything that happened to a reservation: the physical
// BLE station events couriered from the device + the reservation lifecycle
// audit rows + the synthetic money milestones derived from the reservation's
// timestamp columns. This merges all three sources and sorts by time.
//
// It is Deno-free, so Jest imports it directly — same pattern as
// settlement-decide.test.ts / reconcile.test.ts.
import {
  buildDisputeTimeline,
  type TimelineEntry,
} from "../../supabase/functions/_shared/disputeTimeline";

// A reservation with every timestamp null and a session id, unless overridden.
function makeReservation(
  over: Partial<Parameters<typeof buildDisputeTimeline>[0]> = {},
): Parameters<typeof buildDisputeTimeline>[0] {
  return {
    ble_session_id: "sess-A",
    opened_at: null,
    returned_at: null,
    release_eligible_at: null,
    penalty_eligible_at: null,
    reversal_eligible_at: null,
    settled_at: null,
    disputed_at: null,
    deposit_state: "held",
    ...over,
  };
}

describe("buildDisputeTimeline", () => {
  it("returns an empty array for fully-empty input", () => {
    expect(buildDisputeTimeline(makeReservation(), [], [])).toEqual([]);
  });

  it("never throws on missing/partial input (no session id, unsorted, empty)", () => {
    expect(() =>
      buildDisputeTimeline(
        makeReservation({ ble_session_id: null }),
        [],
        [],
      ),
    ).not.toThrow();
  });

  it("emits one reservation-source entry per reservationEvent with kind + detail", () => {
    const out = buildDisputeTimeline(
      makeReservation(),
      [
        { kind: "unlock_signed", payload: { gate: 2 }, at: "2026-06-06T10:00:00.000Z" },
        { kind: "gate_opened", payload: { seq: 5 }, at: "2026-06-06T10:01:00.000Z" },
      ],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      at: "2026-06-06T10:00:00.000Z",
      source: "reservation",
      kind: "unlock_signed",
      detail: { gate: 2 },
    });
    expect(out[1].kind).toBe("gate_opened");
  });

  it("includes station events only for the matching ble_session_id", () => {
    const out = buildDisputeTimeline(
      makeReservation({ ble_session_id: "sess-A" }),
      [],
      [
        { event: "gate_opened", gate: 1, session_id: "sess-A", wall_ts: 111, received_at: "2026-06-06T10:00:00.000Z", seq: 1 },
        { event: "gate_opened", gate: 9, session_id: "sess-OTHER", wall_ts: 222, received_at: "2026-06-06T10:05:00.000Z", seq: 2 },
        { event: "gate_closed", gate: 1, session_id: "sess-A", wall_ts: 333, received_at: "2026-06-06T10:10:00.000Z", seq: 3 },
      ],
    );
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.source === "station")).toBe(true);
    expect(out.map((e) => e.kind)).toEqual(["gate_opened", "gate_closed"]);
    // station entries use received_at as `at` and carry wall_ts + seq in detail
    expect(out[0].at).toBe("2026-06-06T10:00:00.000Z");
    expect(out[0].detail).toMatchObject({ wall_ts: 111, seq: 1, gate: 1 });
  });

  it("null ble_session_id yields zero station entries", () => {
    const out = buildDisputeTimeline(
      makeReservation({ ble_session_id: null }),
      [],
      [
        { event: "gate_opened", session_id: "sess-A", received_at: "2026-06-06T10:00:00.000Z" },
        { event: "gate_opened", session_id: null, received_at: "2026-06-06T10:05:00.000Z" },
      ],
    );
    expect(out).toEqual([]);
  });

  it("emits a deposit milestone only for each NON-NULL timestamp column", () => {
    const out = buildDisputeTimeline(
      makeReservation({
        opened_at: "2026-06-06T10:00:00.000Z",
        returned_at: "2026-06-06T11:00:00.000Z",
        // release/penalty/reversal/disputed all null -> excluded
        settled_at: "2026-06-06T12:00:00.000Z",
        deposit_state: "refunded",
      }),
      [],
      [],
    );
    expect(out.every((e) => e.source === "deposit")).toBe(true);
    expect(out.map((e) => e.kind)).toEqual([
      "gate_opened_at",
      "returned_at",
      "settled(refunded)",
    ]);
  });

  it("the late-return story renders in correct chronological order", () => {
    // gate_opened -> penalty_eligible -> returned -> reversal_eligible -> settled(refunded)
    const out = buildDisputeTimeline(
      makeReservation({
        opened_at: "2026-06-06T10:00:00.000Z",
        penalty_eligible_at: "2026-06-06T12:00:00.000Z",
        returned_at: "2026-06-06T12:30:00.000Z",
        reversal_eligible_at: "2026-06-06T12:31:00.000Z",
        settled_at: "2026-06-06T13:00:00.000Z",
        deposit_state: "refunded",
      }),
      [],
      [],
    );
    expect(out.map((e) => e.kind)).toEqual([
      "gate_opened_at",
      "penalty_eligible",
      "returned_at",
      "reversal_eligible",
      "settled(refunded)",
    ]);
  });

  it("merges + sorts mixed sources ascending by time", () => {
    const out = buildDisputeTimeline(
      makeReservation({
        ble_session_id: "sess-A",
        opened_at: "2026-06-06T10:00:30.000Z",
        settled_at: "2026-06-06T13:00:00.000Z",
        deposit_state: "released",
      }),
      [
        { kind: "unlock_signed", payload: {}, at: "2026-06-06T10:00:00.000Z" },
        { kind: "return_confirmed", payload: {}, at: "2026-06-06T12:00:00.000Z" },
      ],
      [
        { event: "gate_opened", session_id: "sess-A", received_at: "2026-06-06T10:01:00.000Z", seq: 1 },
      ],
    );
    expect(out.map((e) => [e.source, e.kind])).toEqual([
      ["reservation", "unlock_signed"],
      ["deposit", "gate_opened_at"],
      ["station", "gate_opened"],
      ["reservation", "return_confirmed"],
      ["deposit", "settled(released)"],
    ]);
  });

  it("sorts unsorted input correctly", () => {
    const out = buildDisputeTimeline(
      makeReservation(),
      [
        { kind: "c", payload: {}, at: "2026-06-06T03:00:00.000Z" },
        { kind: "a", payload: {}, at: "2026-06-06T01:00:00.000Z" },
        { kind: "b", payload: {}, at: "2026-06-06T02:00:00.000Z" },
      ],
      [],
    );
    expect(out.map((e) => e.kind)).toEqual(["a", "b", "c"]);
  });

  it("keeps source insertion order on equal timestamps (reservation, station, deposit)", () => {
    const T = "2026-06-06T10:00:00.000Z";
    const out: TimelineEntry[] = buildDisputeTimeline(
      makeReservation({ ble_session_id: "sess-A", opened_at: T }),
      [{ kind: "resv", payload: {}, at: T }],
      [{ event: "stn", session_id: "sess-A", received_at: T }],
    );
    expect(out.map((e) => e.source)).toEqual(["reservation", "station", "deposit"]);
  });
});
