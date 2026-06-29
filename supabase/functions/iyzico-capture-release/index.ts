// @ts-nocheck — Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getUserIdFromRequest } from '../_shared/auth.ts';
import { cancel, checkEnv, postauth } from '../_shared/iyzico.ts';

type Input = {
  holdId: string;
  action: 'release' | 'capture';
  amountTry?: number;
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'supabase_not_configured' }, 500);

  const userId = getUserIdFromRequest(req);
  if (!userId) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_response' }, 400);
  }

  if (!input.holdId || (input.action !== 'release' && input.action !== 'capture')) {
    return json({ ok: false, error: 'bad_response' }, 400);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  const conversationId = `${input.action}:${userId}:${Date.now()}`;

  // SECURITY: verify the caller OWNS this hold, and (for capture) cap the amount
  // at the server-recorded hold amount. Without this, any authenticated user
  // could capture/release another user's iyzico hold by guessing a paymentId,
  // for an arbitrary client-supplied amount — a direct money-theft path. We look
  // the hold up in session_holds (service-role; bypasses RLS) and fail CLOSED:
  // if we can't confirm ownership we do NOT touch iyzico.
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) {
    console.error('[iyzico-capture-release] SERVICE_ROLE_KEY missing — cannot verify ownership');
    return json({ ok: false, error: 'generic_sub' }, 500);
  }
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: hold, error: holdErr } = await admin
    .from('session_holds')
    .select('user_id, amount_try, state')
    .eq('hold_id', input.holdId)
    .maybeSingle();

  if (holdErr) {
    console.error('[iyzico-capture-release] hold lookup failed', holdErr);
    return json({ ok: false, error: 'generic_sub' }, 500);
  }
  if (!hold) {
    // No server record for this hold — either it was never ours or it's a stale
    // pre-table hold. Either way we can't verify ownership, so refuse to act.
    console.warn('[iyzico-capture-release] unknown hold', { userId, holdId: input.holdId });
    return json({ ok: false, error: 'not_found' }, 404);
  }
  if (hold.user_id !== userId) {
    console.warn('[iyzico-capture-release] ownership mismatch', { userId, owner: hold.user_id });
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  // Mark the server-side hold record terminal so session-hold-sweep never tries
  // to release a hold the client already resolved. Best-effort: the money action
  // already succeeded by the time we call this. Scoped to state='held' so we
  // never clobber a concurrent terminal transition.
  const markHoldTerminal = async (state: 'captured' | 'released') => {
    try {
      await admin
        .from('session_holds')
        .update({ state, settled_at: new Date().toISOString(), settled_by: 'client' })
        .eq('hold_id', input.holdId)
        .eq('state', 'held');
    } catch (e) {
      console.error('[iyzico-capture-release] session_holds mark failed', e);
    }
  };

  if (input.action === 'release') {
    const res = await cancel({
      locale: 'tr',
      conversationId,
      paymentId: input.holdId,
      ip,
    });
    if (res.status !== 'success') {
      console.warn('[iyzico-cancel] failed', { userId, res });
      return json({ ok: false, error: 'generic_sub' });
    }
    await markHoldTerminal('released');
    return json({ ok: true });
  }

  // Capture: NEVER trust the client amount beyond the recorded hold. Cap at the
  // server-side amount_try (the deposit we actually authorized) and floor at 0.
  const requested = Number(input.amountTry ?? hold.amount_try);
  const safeRequested = Number.isFinite(requested) ? requested : hold.amount_try;
  const amount = Math.min(Math.max(0, safeRequested), hold.amount_try);
  const res = await postauth({
    locale: 'tr',
    conversationId,
    paymentId: input.holdId,
    paidPrice: amount.toFixed(2),
    ip,
    currency: 'TRY',
    installment: 1,
  });
  if (res.status !== 'success') {
    console.warn('[iyzico-postauth] failed', { userId, res });
    return json({ ok: false, error: 'generic_sub' });
  }
  await markHoldTerminal('captured');
  return json({ ok: true });
});
