// PURE money-decision engine — Deno-free, dependency-free.
//
// `decideDepositSettlement` is the single source of truth for WHAT iyzico op
// (if any) to apply to a reservation's safety deposit (teminat, 20 TRY). It
// reads ONLY the Phase 1 seam flags (*_eligible_at) + the current
// deposit_state and returns a decision. It performs NO I/O, calls NO iyzico,
// and never throws — so Jest imports it directly (same proven pattern as
// reconcile.ts and settlement/refundConversationId.ts). The Deno settlement
// worker wires the actual iyzico calls + DB writes around this decision.
//
// ─────────────────────────────────────────────────────────────────────────
// PRECEDENCE (highest wins):  reversal  >  penalty  >  release
// ─────────────────────────────────────────────────────────────────────────
//
// INVARIANT — a RETURNED ball is NEVER net-penalized:
//   When a ball comes back late (after the abandoned-sweep set
//   penalty_eligible_at), Phase 1 (ingest-events/reconcile.ts `gateClosed`)
//   sets reversal_eligible_at AND clears penalty_eligible_at in the same
//   update. Because reversal ALWAYS wins here — and because we additionally
//   never return `capture` whenever reversal is set, regardless of read order
//   or a stale penalty flag — the returned-ball-still-penalized state is
//   impossible. reversal_eligible_at => REFUND a captured penalty, or RELEASE
//   a hold that was never captured (the return beat the sweep).
//
// IDEMPOTENCE — `action === 'none'` means a no-op: the deposit is already in a
//   terminal/target state, or no eligibility flag is set yet. The decision is
//   TOTAL: every (flags, depositState) combination returns a value and never
//   throws, so the worker can replay it safely.

export type DepositState = "held" | "released" | "captured" | "refunded";

export type SettlementFlags = {
  release_eligible_at: string | null;
  penalty_eligible_at: string | null;
  reversal_eligible_at: string | null;
};

export type SettlementAction = "release" | "capture" | "refund" | "none";

export type SettlementDecision = {
  action: SettlementAction;
  nextState: DepositState;
  reason: string;
};

// A flag is "set" iff it is a non-null, non-empty string. (Treat "" — and any
// nullish — as not-set, so a blank column never triggers a money move.)
function isSet(flag: string | null | undefined): boolean {
  return typeof flag === "string" && flag.length > 0;
}

function noop(state: DepositState, reason: string): SettlementDecision {
  return { action: "none", nextState: state, reason };
}

/**
 * Decide what iyzico op to apply to a reservation's safety deposit.
 *
 * Pure + total: never throws; every (flags, depositState) returns a decision.
 * Precedence reversal > penalty > release guarantees a returned ball is never
 * net-penalized (see file header INVARIANT).
 */
export function decideDepositSettlement(
  flags: SettlementFlags,
  depositState: DepositState,
): SettlementDecision {
  const reversal = isSet(flags.reversal_eligible_at);
  const penalty = isSet(flags.penalty_eligible_at);
  const release = isSet(flags.release_eligible_at);

  // ── Precedence 1: reversal wins (a returned ball is never net-penalized) ──
  if (reversal) {
    switch (depositState) {
      case "captured":
        // A penalty was captured before the late return landed: REFUND it.
        return {
          action: "refund",
          nextState: "refunded",
          reason: "reversal: refund the captured penalty (late return)",
        };
      case "held":
        // The return beat the sweep — nothing was ever captured: just RELEASE.
        return {
          action: "release",
          nextState: "released",
          reason: "reversal: release the still-held hold (return beat the sweep)",
        };
      case "released":
        return noop(
          "released",
          "reversal: already released — idempotent no-op",
        );
      case "refunded":
        return noop(
          "refunded",
          "reversal: already refunded — idempotent no-op",
        );
    }
  }

  // ── Precedence 2: penalty (reversal NOT set) ──
  if (penalty) {
    switch (depositState) {
      case "held":
        return {
          action: "capture",
          nextState: "captured",
          reason: "penalty: capture the safety deposit",
        };
      case "captured":
        return noop(
          "captured",
          "penalty: already captured — idempotent no-op (no double capture)",
        );
      case "released":
        return noop(
          "released",
          "penalty: already released (terminal) — don't re-capture",
        );
      case "refunded":
        return noop(
          "refunded",
          "penalty: already refunded (terminal) — don't re-capture",
        );
    }
  }

  // ── Precedence 3: release (no penalty / reversal) ──
  if (release) {
    switch (depositState) {
      case "held":
        return {
          action: "release",
          nextState: "released",
          reason: "release: release the hold (on-time/confirmed return or void)",
        };
      case "released":
        return noop("released", "release: already released — idempotent no-op");
      case "captured":
        return noop(
          "captured",
          "release: already captured — don't reverse a capture from a bare release flag",
        );
      case "refunded":
        return noop(
          "refunded",
          "release: already refunded — idempotent no-op",
        );
    }
  }

  // ── No eligibility flag set: nothing to settle yet. ──
  return noop(depositState, "no eligibility flag set — nothing to settle");
}
