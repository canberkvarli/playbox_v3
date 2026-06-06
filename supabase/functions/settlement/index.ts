// @ts-nocheck — Deno runtime
//
// settlement
// Drives the Phase 2 deposit (teminat, 20 TRY) state machine to its terminal
// state. Scans reservations with a Phase-1 money flag set (release / penalty /
// reversal _eligible_at) whose deposit is not yet terminal, and applies the
// right iyzico op — release (cancel), capture (postauth), or refund — exactly
// once per reservation, with NO double-charge.
//
// THE no-double-charge invariant lives in the PURE core (settlement/process.ts,
// proven by lib/server/settlement-process.test.ts): deposit_state flips to the
// terminal state ONLY AFTER iyzico confirms success. On iyzico failure/throw,
// deposit_state is left UNCHANGED and the row is retried next tick. This shell
// is just the Deno + supabase + iyzico wiring around that pure decision; it
// adds NO money logic of its own.
//
// Service-role / cron only — this moves real money across ALL users, so unlike
// reservation-sweep there is no user-JWT lazy path. Idempotent: re-running on a
// terminal row is a no-op (the decision returns 'none').

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getRoleFromRequest } from '../_shared/auth.ts';
import {
  checkEnv,
  postauth as iyzicoCapture,
  cancel as iyzicoCancel,
  refund as iyzicoRefund,
} from '../_shared/iyzico.ts';
import {
  processSettlement,
  type SettlementCandidate,
  type SettlementIyzico,
  type SettlementStore,
} from './process.ts';

const SCAN_LIMIT = 200;
const DEFAULT_HOLD_TRY = '20';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  // iyzico must be configured before we attempt to move any money. If the keys
  // are missing, respond SAFE (don't attempt) rather than half-settling.
  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'iyzico_not_configured' }, 500);

  // Cron / service-role only — this worker settles across all users.
  const role = getRoleFromRequest(req);
  if (role !== 'service_role') {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // priceTry from app_config (reservation_hold_try), default '20'. Sent as the
  // capture/refund amount; formatted to 2dp to match iyzico's expectations.
  let priceTry = DEFAULT_HOLD_TRY;
  try {
    const { data } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'reservation_hold_try')
      .maybeSingle();
    if (data?.value != null) priceTry = String(data.value);
  } catch (_e) {
    // fall back to default — never block settlement on a config read.
  }
  // Guard the parse: a non-numeric / negative app_config value must NEVER reach
  // iyzico as "NaN" or a negative amount. Fall back to the default and clamp to
  // a sane positive, then format to 2dp.
  let priceNum = Number(priceTry);
  if (!Number.isFinite(priceNum) || priceNum <= 0) priceNum = Number(DEFAULT_HOLD_TRY);
  priceTry = priceNum.toFixed(2);

  // ── Real SettlementStore: supabase-backed implementation of the pure port. ──
  const store: SettlementStore = {
    async getCandidates(limit: number): Promise<SettlementCandidate[]> {
      // Actionable scan: a flag is set AND the deposit isn't terminal for that
      // flag. The pure decision engine is the source of truth for what actually
      // happens per row; this query just narrows the set cheaply.
      //   - held rows with ANY flag set may release / capture / release.
      //   - captured rows with reversal set are refund-pending.
      // (Matches the reservations_settlement_idx partial index from Task 1.)
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select(
          'id, deposit_state, hold_id, hold_txn_id, release_eligible_at, penalty_eligible_at, reversal_eligible_at',
        )
        .or('deposit_state.eq.held,and(deposit_state.eq.captured,reversal_eligible_at.not.is.null)')
        .or('release_eligible_at.not.is.null,penalty_eligible_at.not.is.null,reversal_eligible_at.not.is.null')
        .limit(limit);
      if (error) {
        console.error('[settlement] getCandidates failed', error);
        throw new Error(`getCandidates failed: ${error.message}`);
      }
      const rows = (data ?? []) as SettlementCandidate[];
      // Observability: a full batch means we likely left a backlog behind.
      if (rows.length === SCAN_LIMIT) {
        console.warn(
          '[settlement] batch full (' + SCAN_LIMIT + ') — backlog may exist, will continue next tick',
        );
      }
      return rows;
    },

    async markSettled(id, nextState, nowISO, expectedFrom): Promise<void> {
      // Persisted ONLY AFTER iyzico confirmed success (enforced by process.ts).
      // CONDITIONAL on deposit_state === expectedFrom: a lost-update guard so a
      // concurrent sweep that already advanced this row can't be clobbered by a
      // stale writer. 0 rows affected = another worker won the race; that's fine
      // (the row is terminal) — log and treat as already-settled, do NOT re-call
      // iyzico. (Money-side dedupe is iyzico's stable conversationId idempotency;
      // see CONCURRENCY GUARANTEE in process.ts.)
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .update({ deposit_state: nextState, settled_at: nowISO })
        .eq('id', id)
        .eq('deposit_state', expectedFrom)
        .select('id');
      if (error) throw new Error(`markSettled failed: ${error.message}`);
      if (!data || data.length === 0) {
        console.warn(
          `[settlement] markSettled no-op for ${id}: deposit_state already advanced past ${expectedFrom} (concurrent worker); treating as already-settled`,
        );
      }
    },

    async appendReservationEvent(id, kind, payload): Promise<void> {
      const { error } = await supabaseAdmin
        .from('reservation_events')
        .insert({ reservation_id: id, kind, payload: payload ?? null });
      if (error) console.error('[settlement] appendReservationEvent failed', error);
    },
  };

  // ── Real SettlementIyzico: adapt postauth/cancel/refund, mapping iyzico
  // status==='success' -> ok. The pure core treats ok:false EXACTLY like a
  // throw — state unchanged, retried next tick — so a failure never half-flips.
  const iyzico: SettlementIyzico = {
    async capture({ conversationId, paymentId, priceTry, ip }) {
      const res = await iyzicoCapture({
        locale: 'tr',
        conversationId,
        paymentId,
        paidPrice: priceTry,
        ip,
        currency: 'TRY',
        installment: 1,
      });
      return { ok: res.status === 'success' };
    },
    async release({ conversationId, paymentId, ip }) {
      const res = await iyzicoCancel({ locale: 'tr', conversationId, paymentId, ip });
      return { ok: res.status === 'success' };
    },
    async refund({ conversationId, paymentTxnId, priceTry, ip }) {
      const res = await iyzicoRefund({
        locale: 'tr',
        conversationId,
        paymentTransactionId: paymentTxnId,
        price: priceTry,
        ip,
        currency: 'TRY',
      });
      return { ok: res.status === 'success' };
    },
  };

  const counts = await processSettlement({
    store,
    iyzico,
    now: () => new Date().toISOString(),
    ip: '0.0.0.0',
    priceTry,
    limit: SCAN_LIMIT,
  });

  return json({ ok: true, mode: 'cron', ...counts });
});
