// Unit tests for the pure session<->reservation linkage selector.
//
// This imports the Deno-free module directly (same Jest-can-import pattern as
// canonical-parity.test.ts). It must NOT touch Supabase or Deno.
import {
  selectReservationToLink,
  type ReservationCandidate,
} from "../../supabase/functions/sign-unlock/link-session";

const make = (
  over: Partial<ReservationCandidate> & { id: string },
): ReservationCandidate => ({
  status: "active",
  gate_id: "G1",
  ble_session_id: null,
  created_at: null,
  ...over,
});

const SID = "sess-abc";

describe("selectReservationToLink", () => {
  test("picks the matching consumed reservation", () => {
    const res = selectReservationToLink(
      [make({ id: "r1", status: "consumed", gate_id: "G1" })],
      "G1",
      SID,
    );
    expect(res).toEqual({ reservationId: "r1" });
  });

  test("ignores cancelled and expired_* reservations", () => {
    const res = selectReservationToLink(
      [
        make({ id: "c", status: "cancelled", gate_id: "G1" }),
        make({ id: "ec", status: "expired_captured", gate_id: "G1" }),
        make({ id: "er", status: "expired_released", gate_id: "G1" }),
      ],
      "G1",
      SID,
    );
    expect(res).toEqual({ skip: "no_match" });
  });

  test("ignores reservations on a different gate", () => {
    const res = selectReservationToLink(
      [make({ id: "r1", status: "active", gate_id: "G2" })],
      "G1",
      SID,
    );
    expect(res).toEqual({ skip: "no_match" });
  });

  test("idempotent: already linked to the same session_id is a no-op", () => {
    const res = selectReservationToLink(
      [make({ id: "r1", status: "consumed", gate_id: "G1", ble_session_id: SID })],
      "G1",
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
          gate_id: "G1",
          ble_session_id: "other-session",
        }),
      ],
      "G1",
      SID,
    );
    expect(res).toEqual({ skip: "conflict" });
  });

  test("returns no_match when there are no candidates", () => {
    expect(selectReservationToLink([], "G1", SID)).toEqual({ skip: "no_match" });
  });

  test("prefers consumed over active when both match", () => {
    const res = selectReservationToLink(
      [
        make({ id: "active1", status: "active", gate_id: "G1" }),
        make({ id: "consumed1", status: "consumed", gate_id: "G1" }),
      ],
      "G1",
      SID,
    );
    expect(res).toEqual({ reservationId: "consumed1" });
  });

  test("within same status, prefers the most-recent by created_at", () => {
    const res = selectReservationToLink(
      [
        make({ id: "old", status: "active", gate_id: "G1", created_at: "2026-01-01T00:00:00Z" }),
        make({ id: "new", status: "active", gate_id: "G1", created_at: "2026-06-01T00:00:00Z" }),
      ],
      "G1",
      SID,
    );
    expect(res).toEqual({ reservationId: "new" });
  });
});
