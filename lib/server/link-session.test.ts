// Unit tests for the pure session<->reservation linkage selector.
//
// This imports the Deno-free module directly (same Jest-can-import pattern as
// canonical-parity.test.ts). It must NOT touch Supabase or Deno.
//
// Fixtures use REALISTIC slug gate_ids (`${stationId}-${sport}-${n}`, e.g.
// "DEV-001-football-1") that mirror production reservations.gate_id values.
// The earlier "G1"-style fixtures masked a real bug where the caller matched
// against the bare numeric gate ("1") and never linked anything.
import {
  selectReservationToLink,
  type ReservationCandidate,
} from "../../supabase/functions/sign-unlock/link-session";

const make = (
  over: Partial<ReservationCandidate> & { id: string },
): ReservationCandidate => ({
  status: "active",
  gate_id: "DEV-001-football-1",
  ble_session_id: null,
  created_at: null,
  ...over,
});

const SID = "sess-abc";
const FOOTBALL_1 = "DEV-001-football-1";

describe("selectReservationToLink", () => {
  test("picks the matching consumed reservation by exact slug", () => {
    const res = selectReservationToLink(
      [make({ id: "r1", status: "consumed", gate_id: FOOTBALL_1 })],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ reservationId: "r1" });
  });

  test("ignores cancelled and expired_* reservations", () => {
    const res = selectReservationToLink(
      [
        make({ id: "c", status: "cancelled", gate_id: FOOTBALL_1 }),
        make({ id: "ec", status: "expired_captured", gate_id: FOOTBALL_1 }),
        make({ id: "er", status: "expired_released", gate_id: FOOTBALL_1 }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ skip: "no_match" });
  });

  test("ignores reservations on a different gate slug", () => {
    const res = selectReservationToLink(
      [make({ id: "r1", status: "active", gate_id: "DEV-001-football-2" })],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ skip: "no_match" });
  });

  // KEY REGRESSION TEST: a different-sport slug that ends in the SAME trailing
  // number ("1") must NOT match. If linkage keyed off the numeric gate this
  // would wrongly link the basketball reservation; matching the exact slug
  // prevents the multi-sport ambiguity that motivated this fix.
  test("does NOT match a different sport sharing the same trailing number", () => {
    const res = selectReservationToLink(
      [
        make({ id: "bball", status: "consumed", gate_id: "DEV-001-basketball-1" }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ skip: "no_match" });
  });

  test("picks football-1 and skips basketball-1 when both are present", () => {
    const res = selectReservationToLink(
      [
        make({ id: "bball", status: "consumed", gate_id: "DEV-001-basketball-1" }),
        make({ id: "fball", status: "active", gate_id: FOOTBALL_1 }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ reservationId: "fball" });
  });

  test("idempotent: already linked to the same session_id is a no-op", () => {
    const res = selectReservationToLink(
      [
        make({
          id: "r1",
          status: "consumed",
          gate_id: FOOTBALL_1,
          ble_session_id: SID,
        }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ skip: "already_linked" });
  });

  test("conflict: chosen reservation linked to a different session_id", () => {
    const res = selectReservationToLink(
      [
        make({
          id: "r1",
          status: "consumed",
          gate_id: FOOTBALL_1,
          ble_session_id: "other-session",
        }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ skip: "conflict" });
  });

  test("returns no_match when there are no candidates", () => {
    expect(selectReservationToLink([], FOOTBALL_1, SID)).toEqual({
      skip: "no_match",
    });
  });

  test("prefers consumed over active when both match the same slug", () => {
    const res = selectReservationToLink(
      [
        make({ id: "active1", status: "active", gate_id: FOOTBALL_1 }),
        make({ id: "consumed1", status: "consumed", gate_id: FOOTBALL_1 }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ reservationId: "consumed1" });
  });

  test("within same status, prefers the most-recent by created_at", () => {
    const res = selectReservationToLink(
      [
        make({
          id: "old",
          status: "active",
          gate_id: FOOTBALL_1,
          created_at: "2026-01-01T00:00:00Z",
        }),
        make({
          id: "new",
          status: "active",
          gate_id: FOOTBALL_1,
          created_at: "2026-06-01T00:00:00Z",
        }),
      ],
      FOOTBALL_1,
      SID,
    );
    expect(res).toEqual({ reservationId: "new" });
  });
});
