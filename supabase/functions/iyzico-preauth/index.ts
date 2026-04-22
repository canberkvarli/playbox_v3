// @ts-nocheck — Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { checkEnv, preauth } from '../_shared/iyzico.ts';

type Input = {
  amountTry: number;
  conversationId: string;
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'supabase_not_configured' }, 500);

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_response' }, 400);
  }

  const amount = Number(input.amountTry);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) {
    return json({ ok: false, error: 'bad_response' }, 400);
  }
  const conversationId = String(input.conversationId ?? `preauth:${userId}:${Date.now()}`);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: card, error: cardErr } = await supabase
    .from('user_cards')
    .select('iyzico_card_user_key, iyzico_card_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (cardErr || !card) {
    return json({ ok: false, error: 'generic_sub' }, 400);
  }

  const price = amount.toFixed(2);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';

  const iyz = await preauth({
    locale: 'tr',
    conversationId,
    price,
    paidPrice: price,
    currency: 'TRY',
    installment: 1,
    basketId: conversationId,
    paymentChannel: 'MOBILE',
    paymentGroup: 'PRODUCT',
    paymentCard: {
      cardUserKey: card.iyzico_card_user_key,
      cardToken: card.iyzico_card_token,
    },
    buyer: {
      id: userId,
      name: 'Playbox',
      surname: 'Kullanıcı',
      email: `${userId}@users.playbox.local`,
      identityNumber: '11111111111',
      registrationAddress: 'N/A',
      ip,
      city: 'Istanbul',
      country: 'Turkey',
    },
    shippingAddress: {
      contactName: 'Playbox Kullanıcı',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'N/A',
    },
    billingAddress: {
      contactName: 'Playbox Kullanıcı',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'N/A',
    },
    basketItems: [
      {
        id: 'playbox-session-hold',
        name: 'Playbox Seans Teminatı',
        category1: 'Spor',
        itemType: 'VIRTUAL',
        price,
      },
    ],
  });

  if (iyz.status !== 'success' || !iyz.paymentId) {
    const msg = (iyz.errorMessage ?? '').toLowerCase();
    const errorKey =
      msg.includes('decline') || msg.includes('reddedildi') ? 'card_declined' : 'generic_sub';
    console.warn('[iyzico-preauth] failed', { userId, iyz });
    return json({ ok: false, error: errorKey });
  }

  return json({ ok: true, holdId: iyz.paymentId });
});
