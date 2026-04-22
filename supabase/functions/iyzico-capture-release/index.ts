// @ts-nocheck — Deno runtime
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
  return json({ ok: true });
});
