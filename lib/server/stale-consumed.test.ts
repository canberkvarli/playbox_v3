// Unit tests for the PURE stale-consumed predicate.
//
// Imports the Deno-free module directly (same Jest-can-import pattern as
// abandoned.test.ts / reconcile.test.ts). staleConsumed.ts MUST NOT touch
// Supabase or Deno.
import {
  shouldReleaseStaleConsumed,
  type StaleConsumedCandidate,
} from "../../supabase/functions/session-sweep/staleConsumed";

// Fixed "now" and a 15-minute consume->open window (the index.ts default).
const NOW_MS = Date.parse("2026-06-06T12:00:00.000Z");
const MAX_CONSUME_TO_OPEN_MS = 15 * 60 * 1000;

const candidate = (
  over: Partial<StaleConsumedCandidate>,
): StaleConsumedCandidate => ({
  status: "consumed",
  opened_at: null,
  returned_at: null,
  terminal_at: null,
  release_eligible_at: null,
  penalty_eligible_at: null,
  reversal_eligible_at: null,
  ...over,
});

describe("shouldReleaseStaleConsumed", () => {
  it("consumed + never opened + past timeout + unflagged => true", () => {
    const r = candidate({ terminal_at: "2026-06-06T11:40:00.000Z" }); // 20m ago
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(true);
  });

  it("not yet past the timeout => false", () => {
    const r = candidate({ terminal_at: "2026-06-06T11:50:00.000Z" }); // 10m ago < 15m
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("exactly at the boundary (== timeout) => false (strictly greater)", () => {
    const r = candidate({ terminal_at: "2026-06-06T11:45:00.000Z" }); // exactly 15m ago
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("one ms past the boundary => true", () => {
    const r = candidate({ terminal_at: "2026-06-06T11:44:59.999Z" });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(true);
  });

  it("opened_at set => false (that's the abandoned path, not stranded)", () => {
    const r = candidate({
      terminal_at: "2026-06-06T11:40:00.000Z",
      opened_at: "2026-06-06T11:41:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("returned_at set => false (ball came back)", () => {
    const r = candidate({
      terminal_at: "2026-06-06T11:40:00.000Z",
      returned_at: "2026-06-06T11:50:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("already flagged release_eligible_at => false (idempotent no-op)", () => {
    const r = candidate({
      terminal_at: "2026-06-06T11:40:00.000Z",
      release_eligible_at: "2026-06-06T11:55:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("already flagged penalty_eligible_at => false", () => {
    const r = candidate({
      terminal_at: "2026-06-06T11:40:00.000Z",
      penalty_eligible_at: "2026-06-06T11:55:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("already flagged reversal_eligible_at => false", () => {
    const r = candidate({
      terminal_at: "2026-06-06T11:40:00.000Z",
      reversal_eligible_at: "2026-06-06T11:55:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("active status => false (not yet consumed)", () => {
    const r = candidate({ status: "active", terminal_at: "2026-06-06T11:40:00.000Z" });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("other terminal status (expired_captured) => false", () => {
    const r = candidate({
      status: "expired_captured",
      terminal_at: "2026-06-06T11:40:00.000Z",
    });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("missing terminal_at => false (no consume timestamp)", () => {
    const r = candidate({ terminal_at: null });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });

  it("unparseable terminal_at => false (pure + total, no flagging on garbage)", () => {
    const r = candidate({ terminal_at: "not-a-date" });
    expect(shouldReleaseStaleConsumed(r, NOW_MS, MAX_CONSUME_TO_OPEN_MS)).toBe(false);
  });
});
