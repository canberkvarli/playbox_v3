// @ts-nocheck — Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders, handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { checkEnv, prettyBrand, registerCard } from '../_shared/iyzico.ts';

type Input = {
  cardNumber: string;
  cardHolderName: string;
  expireMonth: string;
  expireYear: string;
  cvc: string; // accepted but not sent to /cardstorage/card (which stores tokenized card without charging)
};

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) {
    return json({ ok: false, error: 'supabase_not_configured' }, 500);
  }

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_response' }, 400);
  }

  const digits = (input.cardNumber ?? '').replace(/\D+/g, '');
  if (
    digits.length < 15 ||
    digits.length > 19 ||
    !input.cardHolderName ||
    !/^\d{2}$/.test(input.expireMonth ?? '') ||
    !/^\d{4}$/.test(input.expireYear ?? '')
  ) {
    return json({ ok: false, error: 'card_invalid' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  // Look up existing cardUserKey so repeat saves reuse the same Iyzico record.
  const { data: existing } = await supabase
    .from('user_cards')
    .select('iyzico_card_user_key')
    .eq('user_id', userId)
    .maybeSingle();

  const iyz = await registerCard({
    locale: 'tr',
    conversationId: `reg:${userId}:${Date.now()}`,
    externalId: userId,
    // Iyzico's validator rejects non-public TLDs (".local" → errorCode 5).
    // playbox.app is the brand domain — synthetic addresses still work
    // because Iyzico only checks format, not deliverability.
    email: `${userId}@users.playbox.app`,
    cardUserKey: existing?.iyzico_card_user_key ?? undefined,
    card: {
      cardAlias: 'playbox',
      cardNumber: digits,
      expireMonth: input.expireMonth,
      expireYear: input.expireYear,
      cardHolderName: input.cardHolderName.trim(),
    },
  });

  if (iyz.status !== 'success' || !iyz.cardToken || !iyz.cardUserKey) {
    const msg = (iyz.errorMessage ?? '').toLowerCase();
    const errorKey =
      msg.includes('decline') || msg.includes('reddedildi') ? 'card_declined' :
      msg.includes('invalid') || msg.includes('geçersiz') ? 'card_invalid' :
      'generic_sub';
    console.warn('[iyzico-register-card] failed', { userId, iyz });
    return json({ ok: false, error: errorKey });
  }

  const last4 = iyz.lastFourDigits ?? digits.slice(-4);
  const brand = prettyBrand(iyz.cardAssociation);

  const { error: upsertErr } = await supabase.from('user_cards').upsert({
    user_id: userId,
    iyzico_card_user_key: iyz.cardUserKey,
    iyzico_card_token: iyz.cardToken,
    last4,
    brand,
  });

  if (upsertErr) {
    console.error('[iyzico-register-card] upsert failed', upsertErr);
    return json({ ok: false, error: 'bad_response' }, 500);
  }

  return json({ ok: true, last4, brand });
});
