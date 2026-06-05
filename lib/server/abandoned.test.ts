// Unit tests for the PURE abandoned-session predicate.
//
// Imports the Deno-free module directly (same Jest-can-import pattern as
// reconcile.test.ts / canonical-parity.test.ts). abandoned.ts MUST NOT touch
// Supabase or Deno.
import {
  shouldFlagAbandoned,
  type AbandonedCandidate,
} from "../../supabase/functions/session-sweep/abandoned";

// Fixed "now" and a 90-minute max in-use window (the index.ts default).
const NOW_MS = Date.parse("2026-06-05T12:00:00.000Z");
const MAX_IN_USE_MS = 90 * 60 * 1000;

const candidate = (over: Partial<AbandonedCandidate>): AbandonedCandidate => ({
  status: "active",
  opened_at: null,
  returned_at: null,
  penalty_eligible_at: null,
  ...over,
});

describe("shouldFlagAbandoned", () => {
  it("opened long ago + not returned + not flagged => true", () => {
    const r = candidate({ opened_at: "2026-06-05T10:00:00.000Z" }); // 2h ago
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(true);
  });

  it("consumed status (hold settled, ball still out) is abandonable => true", () => {
    const r = candidate({ status: "consumed", opened_at: "2026-06-05T10:00:00.000Z" });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(true);
  });

  it("not yet past maxInUse => false", () => {
    const r = candidate({ opened_at: "2026-06-05T11:30:00.000Z" }); // 30m ago < 90m
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("exactly at the boundary (== maxInUse) => false (strictly greater)", () => {
    const r = candidate({ opened_at: "2026-06-05T10:30:00.000Z" }); // exactly 90m ago
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("returned_at set => false (ball came back)", () => {
    const r = candidate({
      opened_at: "2026-06-05T10:00:00.000Z",
      returned_at: "2026-06-05T10:45:00.000Z",
    });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("opened_at null => false (never physically opened — expiry sweep's job)", () => {
    const r = candidate({ opened_at: null });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("already penalty_eligible_at => false (idempotent)", () => {
    const r = candidate({
      opened_at: "2026-06-05T10:00:00.000Z",
      penalty_eligible_at: "2026-06-05T11:35:00.000Z",
    });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("cancelled status => false", () => {
    const r = candidate({ status: "cancelled", opened_at: "2026-06-05T10:00:00.000Z" });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("expired_captured status => false", () => {
    const r = candidate({ status: "expired_captured", opened_at: "2026-06-05T10:00:00.000Z" });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });

  it("unparseable opened_at => false (total: never flag on garbage)", () => {
    const r = candidate({ opened_at: "not-a-timestamp" });
    expect(shouldFlagAbandoned(r, NOW_MS, MAX_IN_USE_MS)).toBe(false);
  });
});
