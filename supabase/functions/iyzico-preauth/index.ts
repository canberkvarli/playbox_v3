// @ts-nocheck — Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { cancel, checkEnv, preauth } from '../_shared/iyzico.ts';

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
      email: `${userId}@users.playbox.app`,
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

  // Record the hold server-side BEFORE returning so it can never be orphaned.
  // The client (session-review) captures/releases it later; if the app dies in
  // between, session-hold-sweep releases it past a TTL. If we CAN'T persist the
  // record, RELEASE the hold and fail — an untracked hold (frozen card) is worse
  // than a failed unlock, which the user simply retries.
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (SERVICE_ROLE_KEY) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { error: insErr } = await admin.from('session_holds').insert({
      hold_id: iyz.paymentId,
      hold_txn_id: iyz.paymentTransactionId ?? null,
      user_id: userId,
      amount_try: Math.round(amount),
    });
    if (insErr) {
      console.error('[iyzico-preauth] session_holds insert failed — releasing hold', insErr);
      try {
        await cancel({
          locale: 'tr',
          conversationId: `preauth-comp:${iyz.paymentId}`,
          paymentId: iyz.paymentId,
          ip,
        });
      } catch (e) {
        console.error('[iyzico-preauth] compensation release threw', e);
      }
      return json({ ok: false, error: 'generic_sub' });
    }
  } else {
    // Should never happen in Supabase (auto-populated). Don't break unlocks, but
    // make the orphan risk loud in logs.
    console.error('[iyzico-preauth] SERVICE_ROLE_KEY missing — hold NOT recorded, orphan risk');
  }

  return json({ ok: true, holdId: iyz.paymentId });
});
