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
import { isSettlementBlocked, shouldQuarantine } from "./guards.ts";

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
  // Phase 4 abuse/quarantine guards. A non-null disputed_at (operator review) or
  // quarantined_at (parked after repeated settle failures) makes the row BLOCKED:
  // it is skipped before decide/iyzico (isSettlementBlocked). settle_attempts is
  // the running count of failed settlement attempts driving the quarantine.
  disputed_at: string | null;
  quarantined_at: string | null;
  settle_attempts: number;
};

// ── PORT: persistence. getCandidates is the actionable scan; markSettled flips
// deposit_state (ONLY called after a confirmed money move); appendReservationEvent
// writes the audit trail. ──
export type SettlementStore = {
  getCandidates(limit: number): Promise<SettlementCandidate[]>;
  // markSettled is a CONDITIONAL state flip: it advances deposit_state to
  // nextState ONLY IF the row is still at `expectedFrom` (the deposit_state the
  // decision was computed from). This is a lost-update guard against concurrent
  // sweeps — see the CONCURRENCY GUARANTEE note near the iyzico calls below.
  markSettled(
    id: string,
    nextState: DepositState,
    nowISO: string,
    expectedFrom: DepositState,
  ): Promise<void>;
  appendReservationEvent(id: string, kind: string, payload: unknown): Promise<void>;
  // ── Phase 4 quarantine ports. recordFailedAttempt bumps settle_attempts and
  // stores settle_last_error on EVERY iyzico failure (ok:false / throw). When
  // the bumped count reaches settle_max_attempts, quarantine parks the row by
  // setting quarantined_at so the worker stops retrying it forever. NEITHER is
  // called on the success path — state flips still ride only on a confirmed move.
  recordFailedAttempt(id: string, errorText: string): Promise<void>;
  quarantine(id: string, nowISO: string): Promise<void>;
};

export type SettlementCounts = {
  released: number;
  captured: number;
  refunded: number;
  failed: number;
  skipped: number;
  // Rows parked this sweep after hitting settle_max_attempts failures.
  quarantined: number;
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
  // Failure count at which a deposit is quarantined (parked) instead of retried.
  maxAttempts: number;
  limit?: number;
}): Promise<SettlementCounts> {
  const { store, iyzico, now, ip, priceTry, maxAttempts } = deps;
  const limit = deps.limit ?? DEFAULT_LIMIT;

  const counts: SettlementCounts = {
    released: 0,
    captured: 0,
    refunded: 0,
    failed: 0,
    skipped: 0,
    quarantined: 0,
  };

  const candidates = await store.getCandidates(limit);

  for (const c of candidates) {
    // Per-row try/catch: a throw (network/iyzico explosion) on one row must
    // NEVER abort the sweep — it's treated exactly like an ok:false and the
    // remaining candidates still settle.
    try {
      // ── Phase 4 GUARD (before decide / any iyzico call): a disputed or
      // quarantined row must NEVER be auto-settled. Skip it entirely — no
      // decision, no money op, no state flip, no audit. (index.ts also excludes
      // these in the candidate query; this is defense in depth.)
      if (isSettlementBlocked(c)) {
        counts.skipped++;
        continue;
      }

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
          await recordFailureAndMaybeQuarantine(store, c, "iyzico_not_ok", now, maxAttempts, counts);
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
          await recordFailureAndMaybeQuarantine(store, c, "iyzico_not_ok", now, maxAttempts, counts);
        }
      }
    } catch (err) {
      // A throw is treated EXACTLY like ok:false: state UNCHANGED (no
      // markSettled was reached), audit the failure, count it, and continue.
      const errorText = err instanceof Error ? err.message : String(err);
      await store.appendReservationEvent(c.id, "deposit_settle_failed", {
        reason: "iyzico_threw",
        error: errorText,
      });
      counts.failed++;
      await recordFailureAndMaybeQuarantine(store, c, errorText, now, maxAttempts, counts);
    }
  }

  return counts;
}

// ─────────────────────────────────────────────────────────────────────────
// CONCURRENCY GUARANTEE — what protects a concurrent double money-move.
//
// The double-capture window: two overlapping sweeps each read the SAME `held`
// candidate before either flips deposit_state, so both reach the iyzico call.
//
//   1. LOAD-BEARING DEDUPE (the money side): iyzico idempotency on the stable
//      conversationId = `settle:<id>:<action>` (built by the ./refundConversationId
//      helpers). Both sweeps send the SAME key for the SAME row+action, so iyzico
//      treats the second as a replay and does NOT double-charge. This — not the DB
//      — is what guarantees the money moves at most once.
//   2. LOST-UPDATE GUARD (the state side): markSettled is a CONDITIONAL update
//      gated on `expectedFrom` (the deposit_state the decision was computed from).
//      The first writer flips held->terminal; the second's conditional update
//      matches 0 rows (state already advanced) and is a harmless no-op. This
//      prevents a stale writer from clobbering deposit_state.
//
//   FOLLOW-UP (multi-worker scale): to also avoid the redundant second iyzico
//   round-trip, claim candidates with `FOR UPDATE SKIP LOCKED` or a transient
//   `settling` claim state in getCandidates so only one worker ever picks a row.
// ─────────────────────────────────────────────────────────────────────────
//
// Persist the state flip ONLY AFTER a confirmed money move, then audit. Order
// matters: markSettled first so a crash between the two re-audits but never
// re-charges (deposit_state is already terminal -> next decision is 'none').
// expectedFrom = the ORIGINAL deposit_state the decision rode on, so the write
// is conditional (lost-update guard above).
// ─────────────────────────────────────────────────────────────────────────
// QUARANTINE-ON-REPEATED-FAILURE (the Phase 2 failing-candidate follow-up).
//
// Called ONLY on an iyzico FAILURE (ok:false or throw) — NEVER on success, so it
// can't touch the no-double-charge contract (deposit_state still flips only after
// a confirmed move; quarantine never flips deposit_state at all). On each failure:
//   1. recordFailedAttempt -> settle_attempts += 1, settle_last_error = errorText.
//   2. newAttempts = c.settle_attempts + 1 (the value AFTER this failure).
//   3. if shouldQuarantine(newAttempts, maxAttempts): quarantine the row
//      (set quarantined_at) + audit deposit_quarantined + counts.quarantined++.
// A permanently-failing deposit (e.g. a deleted iyzico ref) thus stops retrying
// once it crosses the threshold, instead of looping forever every tick.
async function recordFailureAndMaybeQuarantine(
  store: SettlementStore,
  c: SettlementCandidate,
  errorText: string,
  now: () => string,
  maxAttempts: number,
  counts: SettlementCounts,
): Promise<void> {
  await store.recordFailedAttempt(c.id, errorText);
  const newAttempts = c.settle_attempts + 1;
  if (shouldQuarantine(newAttempts, maxAttempts)) {
    const nowISO = now();
    await store.quarantine(c.id, nowISO);
    await store.appendReservationEvent(c.id, "deposit_quarantined", {
      attempts: newAttempts,
      lastError: errorText,
    });
    counts.quarantined++;
  }
}

async function finishSuccess(
  store: SettlementStore,
  c: SettlementCandidate,
  nextState: DepositState,
  nowISO: string,
  action: "capture" | "release" | "refund",
  conversationId: string,
  reason: string,
): Promise<void> {
  await store.markSettled(c.id, nextState, nowISO, c.deposit_state);
  await store.appendReservationEvent(c.id, "deposit_" + action, {
    conversationId,
    from: c.deposit_state,
    to: nextState,
    reason,
  });
}
