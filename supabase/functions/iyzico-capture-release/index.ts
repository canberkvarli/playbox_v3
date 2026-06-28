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

  // Mark the server-side hold record terminal so session-hold-sweep never tries
  // to release a hold the client already resolved. Best-effort: the money action
  // already succeeded by the time we call this, so a failed UPDATE must not fail
  // the user's request (a still-'held' row would just be retried by the sweep,
  // whose cancel of an already-resolved hold is itself a safe no-op). Scoped to
  // state='held' so we never clobber a concurrent terminal transition.
  const markHoldTerminal = async (state: 'captured' | 'released') => {
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SERVICE_ROLE_KEY) return;
    try {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });
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

  const amount = Number(input.amountTry ?? 150);
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
