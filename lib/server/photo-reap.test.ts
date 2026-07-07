// Unit tests for the PURE return-photo reaper predicate.
//
// Imports the Deno-free module directly (same Jest-can-import pattern as
// abandoned.test.ts). reap.ts MUST NOT touch Supabase or Deno.
import {
  shouldReapPhoto,
  type ReapCandidate,
} from "../../supabase/functions/photo-reap/reap";

// Fixed "now" and a 30-day retention window (the migration default).
const NOW_MS = Date.parse("2026-07-07T12:00:00.000Z");
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const candidate = (over: Partial<ReapCandidate>): ReapCandidate => ({
  created_at: null,
  hasLiveDispute: false,
  ...over,
});

describe("shouldReapPhoto", () => {
  it("older than retention + no dispute => true", () => {
    const o = candidate({ created_at: "2026-06-01T12:00:00.000Z" }); // ~36d ago
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(true);
  });

  it("younger than retention => false", () => {
    const o = candidate({ created_at: "2026-07-01T12:00:00.000Z" }); // 6d ago
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(false);
  });

  it("exactly at the boundary (== retention) => false (strictly greater)", () => {
    const o = candidate({ created_at: "2026-06-07T12:00:00.000Z" }); // exactly 30d
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(false);
  });

  it("live dispute keeps the evidence even when old => false", () => {
    const o = candidate({
      created_at: "2026-01-01T12:00:00.000Z", // ancient
      hasLiveDispute: true,
    });
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(false);
  });

  it("null created_at => false (never delete on missing data)", () => {
    const o = candidate({ created_at: null });
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(false);
  });

  it("unparseable created_at => false (never delete on bad data)", () => {
    const o = candidate({ created_at: "not-a-date" });
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(false);
  });

  it("just past the boundary (retention + 1ms) => true", () => {
    const o = candidate({ created_at: "2026-06-07T11:59:59.999Z" }); // 30d + 1ms
    expect(shouldReapPhoto(o, NOW_MS, RETENTION_MS)).toBe(true);
  });

  it("null candidate object => false (total, never throws)", () => {
    // @ts-expect-error — exercising the defensive guard
    expect(shouldReapPhoto(null, NOW_MS, RETENTION_MS)).toBe(false);
  });
});
