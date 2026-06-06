// Unit tests for the PURE money-decision engine: decideDepositSettlement.
//
// This is the most safety-critical piece of Phase 2. It decides what iyzico
// op (if any) to apply to a reservation's safety deposit, given the Phase 1
// seam flags (*_eligible_at) + the current deposit_state.
//
// Precedence: reversal > penalty > release. INVARIANT: a RETURNED ball is
// never net-penalized (a late return sets reversal_eligible_at, which always
// wins over penalty). It is Deno-free, so Jest imports it directly — same
// pattern as reconcile.test.ts / settlement-ids.test.ts.
import {
  decideDepositSettlement,
  type DepositState,
  type SettlementFlags,
  type SettlementAction,
} from "../../supabase/functions/settlement/decide";

const ISO = "2026-06-06T12:00:00.000Z";

// Build flags with only the named ones set (non-null ISO string).
function flags(set: Partial<SettlementFlags> = {}): SettlementFlags {
  return {
    release_eligible_at: set.release_eligible_at ?? null,
    penalty_eligible_at: set.penalty_eligible_at ?? null,
    reversal_eligible_at: set.reversal_eligible_at ?? null,
  };
}

const ALL_STATES: DepositState[] = ["held", "released", "captured", "refunded"];

describe("decideDepositSettlement", () => {
  // ---- Precedence 1: reversal_eligible_at set (wins over everything) ----
  describe("reversal set", () => {
    test("captured -> refund -> refunded", () => {
      const d = decideDepositSettlement(
        flags({ reversal_eligible_at: ISO }),
        "captured",
      );
      expect(d.action).toBe("refund");
      expect(d.nextState).toBe("refunded");
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(0);
    });

    test("held (penalty never captured; return beat the sweep) -> release -> released", () => {
      const d = decideDepositSettlement(
        flags({ reversal_eligible_at: ISO }),
        "held",
      );
      expect(d.action).toBe("release");
      expect(d.nextState).toBe("released");
    });

    test("released -> none, unchanged (idempotent)", () => {
      const d = decideDepositSettlement(
        flags({ reversal_eligible_at: ISO }),
        "released",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("released");
    });

    test("refunded -> none, unchanged (idempotent)", () => {
      const d = decideDepositSettlement(
        flags({ reversal_eligible_at: ISO }),
        "refunded",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("refunded");
    });
  });

  // ---- Precedence 2: penalty_eligible_at set, reversal NOT set ----
  describe("penalty set (reversal NOT set)", () => {
    test("held -> capture -> captured", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO }),
        "held",
      );
      expect(d.action).toBe("capture");
      expect(d.nextState).toBe("captured");
    });

    test("captured -> none, unchanged (idempotent, NO double capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO }),
        "captured",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("captured");
    });

    test("released -> none, unchanged (already terminal; don't re-capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO }),
        "released",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("released");
    });

    test("refunded -> none, unchanged (already terminal; don't re-capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO }),
        "refunded",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("refunded");
    });
  });

  // ---- Precedence 3: release_eligible_at set, no penalty/reversal ----
  describe("release set (no penalty/reversal)", () => {
    test("held -> release -> released", () => {
      const d = decideDepositSettlement(
        flags({ release_eligible_at: ISO }),
        "held",
      );
      expect(d.action).toBe("release");
      expect(d.nextState).toBe("released");
    });

    test("released -> none, unchanged", () => {
      const d = decideDepositSettlement(
        flags({ release_eligible_at: ISO }),
        "released",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("released");
    });

    test("captured -> none, unchanged (don't reverse a capture from a bare release flag)", () => {
      const d = decideDepositSettlement(
        flags({ release_eligible_at: ISO }),
        "captured",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("captured");
    });

    test("refunded -> none, unchanged", () => {
      const d = decideDepositSettlement(
        flags({ release_eligible_at: ISO }),
        "refunded",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("refunded");
    });
  });

  // ---- No flags set: always a no-op, state unchanged ----
  describe("no flags set", () => {
    test.each(ALL_STATES)("%s -> none, unchanged", (state) => {
      const d = decideDepositSettlement(flags(), state);
      expect(d.action).toBe("none");
      expect(d.nextState).toBe(state);
    });
  });

  // ---- SAFETY: the late-return race. BOTH penalty AND reversal set. ----
  // reversal MUST win; the returned ball is never net-penalized. NEVER capture.
  describe("SAFETY: penalty AND reversal both set (late-return race)", () => {
    test("captured -> refund -> refunded (reversal wins, never capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
        "captured",
      );
      expect(d.action).toBe("refund");
      expect(d.nextState).toBe("refunded");
      expect(d.action).not.toBe("capture");
    });

    test("held -> release -> released (reversal wins, never capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
        "held",
      );
      expect(d.action).toBe("release");
      expect(d.nextState).toBe("released");
      expect(d.action).not.toBe("capture");
    });

    test("released -> none (reversal wins, never capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
        "released",
      );
      expect(d.action).toBe("none");
      expect(d.action).not.toBe("capture");
    });

    test("refunded -> none (reversal wins, never capture)", () => {
      const d = decideDepositSettlement(
        flags({ penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
        "refunded",
      );
      expect(d.action).toBe("none");
      expect(d.action).not.toBe("capture");
    });

    test("reversal+penalty NEVER returns capture across ALL deposit_states", () => {
      for (const state of ALL_STATES) {
        const d = decideDepositSettlement(
          flags({ penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
          state,
        );
        expect(d.action).not.toBe("capture");
      }
    });
  });

  // ---- Empty-string flags are treated as NOT set (non-null/non-empty rule) ----
  describe("empty-string flags count as not-set", () => {
    test("reversal='' is ignored; penalty wins on held -> capture", () => {
      const d = decideDepositSettlement(
        { release_eligible_at: null, penalty_eligible_at: ISO, reversal_eligible_at: "" },
        "held",
      );
      expect(d.action).toBe("capture");
      expect(d.nextState).toBe("captured");
    });

    test("all empty strings -> none, unchanged", () => {
      const d = decideDepositSettlement(
        { release_eligible_at: "", penalty_eligible_at: "", reversal_eligible_at: "" },
        "held",
      );
      expect(d.action).toBe("none");
      expect(d.nextState).toBe("held");
    });
  });

  // ---- TOTALITY: every (flag-combo x deposit_state) returns a valid result. ----
  describe("totality: never throws, always valid action+nextState", () => {
    const VALID_ACTIONS: SettlementAction[] = ["release", "capture", "refund", "none"];
    const BOOLS = [false, true];

    test("all (flag-combos x deposit_states) are total and valid", () => {
      let combos = 0;
      for (const rel of BOOLS) {
        for (const pen of BOOLS) {
          for (const rev of BOOLS) {
            for (const state of ALL_STATES) {
              const f = flags({
                release_eligible_at: rel ? ISO : null,
                penalty_eligible_at: pen ? ISO : null,
                reversal_eligible_at: rev ? ISO : null,
              });
              let d: ReturnType<typeof decideDepositSettlement> | undefined;
              expect(() => {
                d = decideDepositSettlement(f, state);
              }).not.toThrow();
              expect(d).toBeDefined();
              expect(VALID_ACTIONS).toContain(d!.action);
              expect(ALL_STATES).toContain(d!.nextState);
              expect(typeof d!.reason).toBe("string");
              expect(d!.reason.length).toBeGreaterThan(0);

              // INVARIANT cross-check: whenever reversal is set, we MUST NOT
              // capture (a returned ball is never net-penalized).
              if (rev) expect(d!.action).not.toBe("capture");
              combos++;
            }
          }
        }
      }
      expect(combos).toBe(2 * 2 * 2 * ALL_STATES.length); // 32 combos
    });
  });

  // ---- REASON UNIQUENESS: each distinct money-decision has a distinct reason ----
  // Iterate all 2x2x2 flag-combos x 4 deposit_states (32 combos), collect every
  // returned decision, and prove the audit `reason` string uniquely identifies
  // the money-decision it came from: no two distinct (action, nextState) pairs
  // may share a reason, and no reason may be empty. This guards against a future
  // edit collapsing two distinct money-reasons into one ambiguous audit string.
  describe("reason uniqueness (distinct money-decisions => distinct reasons)", () => {
    const BOOLS = [false, true];

    test("reason string uniquely identifies each (action, nextState) decision", () => {
      // reason -> set of distinct "action|nextState" signatures seen for it.
      const reasonToDecisions = new Map<string, Set<string>>();
      // distinct (action|nextState|reason) branches actually reached.
      const distinctBranches = new Set<string>();

      for (const rel of BOOLS) {
        for (const pen of BOOLS) {
          for (const rev of BOOLS) {
            for (const state of ALL_STATES) {
              const d = decideDepositSettlement(
                flags({
                  release_eligible_at: rel ? ISO : null,
                  penalty_eligible_at: pen ? ISO : null,
                  reversal_eligible_at: rev ? ISO : null,
                }),
                state,
              );

              // Every reason must be a non-empty string.
              expect(typeof d.reason).toBe("string");
              expect(d.reason.length).toBeGreaterThan(0);

              // A money-decision is characterized by its `action`; for moves
              // (action !== 'none') the resulting nextState is also meaningful.
              // For a no-op, nextState merely echoes the input deposit_state, so
              // it is NOT part of the decision identity — otherwise the single
              // "nothing to settle" branch would look like 4 decisions.
              const decisionSig =
                d.action === "none" ? "none" : `${d.action}|${d.nextState}`;
              distinctBranches.add(`${decisionSig}|${d.reason}`);

              const seen = reasonToDecisions.get(d.reason) ?? new Set<string>();
              seen.add(decisionSig);
              reasonToDecisions.set(d.reason, seen);
            }
          }
        }
      }

      // No reason may map to more than one distinct money-decision.
      for (const [reason, decisions] of reasonToDecisions) {
        expect({ reason, decisions: [...decisions] }).toEqual({
          reason,
          decisions: [...decisions].slice(0, 1),
        });
      }

      // The number of DISTINCT reasons equals the number of distinct decision
      // branches reached — i.e. reason <-> branch is a bijection.
      expect(reasonToDecisions.size).toBe(distinctBranches.size);
    });
  });
});
