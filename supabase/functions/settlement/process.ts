// PURE settlement orchestration — Deno-free, ports-only.
//
// processSettlement scans candidate reservations (a Phase-1 money flag set, the
// deposit not yet terminal) and drives the right iyzico op (release / capture /
// refund) idempotently, with NO double-charge. It imports ONLY the pure Task 3
// decision engine (./decide) and the Task 2 conversationId builders
// (./refundConversationId). All side effects (DB, iyzico) go through PORTS, so
// Jest tests it directly with in-memory recording fakes — no Deno, no network.
//
// ─────────────────────────────────────────────────────────────────────────
// HARD CONTRACT — the no-double-charge invariant (from Task 3's CONSUMER
// CONTRACT). We persist deposit_state = nextState ONLY AFTER the iyzico op
// returns success. On iyzico failure / unknown / throw: deposit_state is left
// UNCHANGED, a deposit_settle_failed audit is appended, and we CONTINUE (the
// row is retried next tick). Flipping deposit_state without a confirmed money
// move would make the next sweep's idempotency guard (decision === 'none')
// silently skip the real op → money never moves. This is the single most
// important rule in this file. State flips ride on confirmed money movement.
// ─────────────────────────────────────────────────────────────────────────

import {
  decideDepositSettlement,
  type DepositState,
  type SettlementFlags,
} from "./decide.ts";
import {
  captureConversationId,
  refundConversationId,
  releaseConversationId,
} from "./refundConversationId.ts";

// ── PORT: iyzico money ops. Each returns { ok } — true ONLY on a confirmed
// money move (the Deno adapter maps iyzico status==='success' -> ok:true). ──
export type SettlementIyzico = {
  capture(args: {
    conversationId: string;
    paymentId: string;
    priceTry: string;
    ip: string;
  }): Promise<{ ok: boolean }>;
  release(args: {
    conversationId: string;
    paymentId: string;
    ip: string;
  }): Promise<{ ok: boolean }>;
  refund(args: {
    conversationId: string;
    paymentTxnId: string;
    priceTry: string;
    ip: string;
  }): Promise<{ ok: boolean }>;
};

// A scannable reservation: the deposit state machine columns + Phase 1 flags +
// the iyzico payment refs. hold_id = iyzico paymentId (capture/release);
// hold_txn_id = iyzico paymentTransactionId (refund). Either may be null on
// legacy / partial rows — we degrade gracefully rather than guess.
export type SettlementCandidate = {
  id: string;
  deposit_state: DepositState;
  hold_id: string | null;
  hold_txn_id: string | null;
  release_eligible_at: string | null;
  penalty_eligible_at: string | null;
  reversal_eligible_at: string | null;
};

// ── PORT: persistence. getCandidates is the actionable scan; markSettled flips
// deposit_state (ONLY called after a confirmed money move); appendReservationEvent
// writes the audit trail. ──
export type SettlementStore = {
  getCandidates(limit: number): Promise<SettlementCandidate[]>;
  markSettled(id: string, nextState: DepositState, nowISO: string): Promise<void>;
  appendReservationEvent(id: string, kind: string, payload: unknown): Promise<void>;
};

export type SettlementCounts = {
  released: number;
  captured: number;
  refunded: number;
  failed: number;
  skipped: number;
};

const DEFAULT_LIMIT = 200;

function flagsOf(c: SettlementCandidate): SettlementFlags {
  return {
    release_eligible_at: c.release_eligible_at,
    penalty_eligible_at: c.penalty_eligible_at,
    reversal_eligible_at: c.reversal_eligible_at,
  };
}

/**
 * Scan candidates and settle each one's deposit idempotently.
 *
 * Per candidate:
 *   1. decision = decideDepositSettlement(flags, deposit_state).
 *   2. action 'none'        -> skipped++, continue (idempotency guard).
 *   3. required payment ref missing -> NO iyzico call; audit
 *      deposit_settle_failed{reason:'missing_payment_ref'}; failed++.
 *   4. call the iyzico op (stable conversationId from the Task 2 helper).
 *   5. ok:true  -> markSettled(nextState) THEN audit deposit_<action>; count++.
 *   6. ok:false OR throw -> DO NOT markSettled; audit deposit_settle_failed;
 *      failed++; continue. One row's failure never blocks the others.
 */
export async function processSettlement(deps: {
  store: SettlementStore;
  iyzico: SettlementIyzico;
  now: () => string;
  ip: string;
  priceTry: string;
  limit?: number;
}): Promise<SettlementCounts> {
  const { store, iyzico, now, ip, priceTry } = deps;
  const limit = deps.limit ?? DEFAULT_LIMIT;

  const counts: SettlementCounts = {
    released: 0,
    captured: 0,
    refunded: 0,
    failed: 0,
    skipped: 0,
  };

  const candidates = await store.getCandidates(limit);

  for (const c of candidates) {
    // Per-row try/catch: a throw (network/iyzico explosion) on one row must
    // NEVER abort the sweep — it's treated exactly like an ok:false and the
    // remaining candidates still settle.
    try {
      const decision = decideDepositSettlement(flagsOf(c), c.deposit_state);
      const action = decision.action;

      if (action === "none") {
        // Already terminal / nothing eligible yet — the no-op idempotency
        // guard. No iyzico call, no state flip, no audit.
        counts.skipped++;
        continue;
      }

      // Resolve the iyzico call + the payment ref it requires. capture/release
      // key on hold_id (paymentId); refund keys on hold_txn_id
      // (paymentTransactionId). Missing ref -> graceful degrade, never guess.
      let ok: boolean;
      if (action === "capture" || action === "release") {
        if (!c.hold_id) {
          await store.appendReservationEvent(c.id, "deposit_settle_failed", {
            action,
            reason: "missing_payment_ref",
          });
          counts.failed++;
          continue;
        }
        const conversationId = action === "capture"
          ? captureConversationId(c.id)
          : releaseConversationId(c.id);
        const res = action === "capture"
          ? await iyzico.capture({ conversationId, paymentId: c.hold_id, priceTry, ip })
          : await iyzico.release({ conversationId, paymentId: c.hold_id, ip });
        ok = res.ok;

        if (ok) {
          await finishSuccess(store, c, decision.nextState, now(), action, conversationId, decision.reason);
          if (action === "capture") counts.captured++;
          else counts.released++;
        } else {
          await store.appendReservationEvent(c.id, "deposit_settle_failed", {
            action,
            conversationId,
            reason: "iyzico_not_ok",
          });
          counts.failed++;
        }
      } else {
        // action === 'refund'
        if (!c.hold_txn_id) {
          await store.appendReservationEvent(c.id, "deposit_settle_failed", {
            action,
            reason: "missing_payment_ref",
          });
          counts.failed++;
          continue;
        }
        const conversationId = refundConversationId(c.id);
        const res = await iyzico.refund({
          conversationId,
          paymentTxnId: c.hold_txn_id,
          priceTry,
          ip,
        });
        ok = res.ok;

        if (ok) {
          await finishSuccess(store, c, decision.nextState, now(), action, conversationId, decision.reason);
          counts.refunded++;
        } else {
          await store.appendReservationEvent(c.id, "deposit_settle_failed", {
            action,
            conversationId,
            reason: "iyzico_not_ok",
          });
          counts.failed++;
        }
      }
    } catch (err) {
      // A throw is treated EXACTLY like ok:false: state UNCHANGED (no
      // markSettled was reached), audit the failure, count it, and continue.
      await store.appendReservationEvent(c.id, "deposit_settle_failed", {
        reason: "iyzico_threw",
        error: err instanceof Error ? err.message : String(err),
      });
      counts.failed++;
    }
  }

  return counts;
}

// Persist the state flip ONLY AFTER a confirmed money move, then audit. Order
// matters: markSettled first so a crash between the two re-audits but never
// re-charges (deposit_state is already terminal -> next decision is 'none').
async function finishSuccess(
  store: SettlementStore,
  c: SettlementCandidate,
  nextState: DepositState,
  nowISO: string,
  action: "capture" | "release" | "refund",
  conversationId: string,
  reason: string,
): Promise<void> {
  await store.markSettled(c.id, nextState, nowISO);
  await store.appendReservationEvent(c.id, "deposit_" + action, {
    conversationId,
    from: c.deposit_state,
    to: nextState,
    reason,
  });
}
