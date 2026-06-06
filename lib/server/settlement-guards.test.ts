// Pure guard semantics for the settlement worker's abuse/quarantine hardening
// (Phase 4, Task 2). Deno-free, so Jest imports the guards directly — same
// pattern as settlement-process.test.ts.
//
// Two total, pure predicates:
//   - isSettlementBlocked: a row under dispute OR quarantine must NEVER be
//     auto-settled; treat ""/null timestamps as not-set.
//   - shouldQuarantine: a deposit that has failed settlement >= maxAttempts
//     times must be parked so it stops retrying forever.
import {
  isSettlementBlocked,
  shouldQuarantine,
} from "../../supabase/functions/settlement/guards";

describe("isSettlementBlocked — disputed OR quarantined => skip", () => {
  it("disputed only -> blocked", () => {
    expect(isSettlementBlocked({ disputed_at: "2026-06-06T00:00:00Z", quarantined_at: null })).toBe(true);
  });

  it("quarantined only -> blocked", () => {
    expect(isSettlementBlocked({ disputed_at: null, quarantined_at: "2026-06-06T00:00:00Z" })).toBe(true);
  });

  it("both set -> blocked", () => {
    expect(isSettlementBlocked({ disputed_at: "2026-06-06T00:00:00Z", quarantined_at: "2026-06-06T00:00:00Z" })).toBe(true);
  });

  it("neither set (both null) -> NOT blocked", () => {
    expect(isSettlementBlocked({ disputed_at: null, quarantined_at: null })).toBe(false);
  });

  it("empty-string timestamps are treated as not-set -> NOT blocked", () => {
    expect(isSettlementBlocked({ disputed_at: "", quarantined_at: "" })).toBe(false);
  });

  it("empty-string dispute but real quarantine -> blocked (quarantine wins)", () => {
    expect(isSettlementBlocked({ disputed_at: "", quarantined_at: "2026-06-06T00:00:00Z" })).toBe(true);
  });
});

describe("shouldQuarantine — park at the failure threshold", () => {
  it("attempts < max -> false", () => {
    expect(shouldQuarantine(4, 5)).toBe(false);
  });

  it("attempts == max -> true (boundary)", () => {
    expect(shouldQuarantine(5, 5)).toBe(true);
  });

  it("attempts > max -> true", () => {
    expect(shouldQuarantine(6, 5)).toBe(true);
  });

  it("zero attempts -> false", () => {
    expect(shouldQuarantine(0, 5)).toBe(false);
  });
});
