// @ts-nocheck — Deno runtime
//
// reservation-create
// Creates a 30-minute station-gate hold backed by an Iyzico pre-auth.
//
// Required env vars on the Supabase project:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL
//
// Request:  { station_id, sport, gate_id, agreed?, app_version? }
// Success:  { ok: true, reservation: { ... } }
// Errors:
//   401 unauthorized
//   400 bad_request | no_card
//   402 card_declined | preauth_failed
//   403 locked
//   409 has_active_reservation | gate_taken | gate_taken_race
//   412 terms_required
//   429 velocity_hour | velocity_day
//   500 service_role_missing | iyzico_not_configured | insert_failed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { cancel as iyzicoRelease, checkEnv, preauth as iyzicoPreauth } from '../_shared/iyzico.ts';
import { getAppConfig, logEvent } from '../_shared/reservations.ts';

type Input = {
  station_id: string;
  sport: 'football' | 'basketball' | 'volleyball' | 'tennis';
  gate_id: string;
  agreed?: boolean;
  app_version?: string;
};

const SPORTS = new Set(['football', 'basketball', 'volleyball', 'tennis']);

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const envCheck = checkEnv();
  if (!envCheck.ok) return json({ ok: false, error: 'iyzico_not_configured' }, 500);

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (
    !input.station_id ||
    typeof input.station_id !== 'string' ||
    !input.gate_id ||
    typeof input.gate_id !== 'string' ||
    !SPORTS.has(input.sport)
  ) {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Card on file
  const { data: card, error: cardErr } = await supabaseAdmin
    .from('user_cards')
    .select('iyzico_card_user_key, iyzico_card_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (cardErr || !card) return json({ ok: false, error: 'no_card' }, 400);

  // 2. Config
  const cfg = await getAppConfig(supabaseAdmin);

  // 3. Active lock
  const { data: lock } = await supabaseAdmin
    .from('user_reservation_locks')
    .select('reason, locked_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (lock) {
    const stillLocked =
      lock.locked_until === 'infinity' ||
      new Date(lock.locked_until).getTime() > Date.now();
    if (stillLocked) {
      return json(
        { ok: false, error: 'locked', reason: lock.reason, locked_until: lock.locked_until },
        403,
      );
    }
  }

  // 4. Already has active reservation?
  const { data: existing } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) {
    return json(
      { ok: false, error: 'has_active_reservation', reservation_id: existing.id },
      409,
    );
  }

  // 5. Velocity caps
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString();
  const [{ count: hourCount }, { count: dayCount }] = await Promise.all([
    supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo),
    supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneDayAgo),
  ]);
  if ((hourCount ?? 0) >= cfg.velocity_per_hour) {
    return json({ ok: false, error: 'velocity_hour' }, 429);
  }
  if ((dayCount ?? 0) >= cfg.velocity_per_day) {
    return json({ ok: false, error: 'velocity_day' }, 429);
  }

  // 6. Terms — first-time path requires the slide-deck `agreed` flag
  const { data: termsAccepted } = await supabaseAdmin
    .from('terms_acceptances')
    .select('terms_version')
    .eq('user_id', userId)
    .eq('terms_version', cfg.terms_version)
    .maybeSingle();
  if (!termsAccepted) {
    if (!input.agreed) {
      return json(
        { ok: false, error: 'terms_required', terms_version: cfg.terms_version },
        412,
      );
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    await supabaseAdmin.from('terms_acceptances').insert({
      user_id: userId,
      terms_version: cfg.terms_version,
      app_version: input.app_version ?? null,
      ip,
    });
  }

  // 7. Gate availability — pre-check (the unique partial index is the
  //    final authority; this just gives a clean 409 in the common case).
  const { data: gateConflict } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('station_id', input.station_id)
    .eq('gate_id', input.gate_id)
    .eq('status', 'active')
    .maybeSingle();
  if (gateConflict) return json({ ok: false, error: 'gate_taken' }, 409);

  // 8. Iyzico preauth — only call once we've cleared every cheaper check
  const conversationId = `reserve:${userId}:${Date.now()}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '0.0.0.0';
  const price = cfg.reservation_hold_try.toFixed(2);

  const iyz = await iyzicoPreauth({
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
        id: 'playbox-reservation-hold',
        name: 'Playbox Rezervasyon Teminatı',
        category1: 'Spor',
        itemType: 'VIRTUAL',
        price,
      },
    ],
  });

  if (iyz.status !== 'success' || !iyz.paymentId) {
    const msg = (iyz.errorMessage ?? '').toLowerCase();
    const errorKey =
      msg.includes('decline') || msg.includes('reddedildi') ? 'card_declined' : 'preauth_failed';
    console.warn('[reservation-create] preauth failed', { userId, iyz });
    return json({ ok: false, error: errorKey }, 402);
  }

  // 9. Insert. The unique partial indexes do the final race-safety —
  //    if two creates land on the same gate at the same instant, one
  //    fails with 23505 and we compensate by releasing its hold.
  const expiresAt = new Date(Date.now() + cfg.reservation_lock_min * 60 * 1000).toISOString();
  const { data: created, error: insErr } = await supabaseAdmin
    .from('reservations')
    .insert({
      user_id: userId,
      station_id: input.station_id,
      sport: input.sport,
      gate_id: input.gate_id,
      hold_id: iyz.paymentId,
      hold_amount_try: cfg.reservation_hold_try,
      terms_version: cfg.terms_version,
      status: 'active',
      expires_at: expiresAt,
      client_meta: input.app_version ? { app_version: input.app_version } : null,
    })
    .select()
    .single();

  if (insErr || !created) {
    console.error('[reservation-create] insert failed; releasing hold', { userId, insErr });
    try {
      await iyzicoRelease({
        locale: 'tr',
        conversationId: `reserve-rollback:${conversationId}`,
        paymentId: iyz.paymentId,
        ip,
      });
    } catch (e) {
      console.error('[reservation-create] rollback release also failed', e);
    }
    if (insErr?.code === '23505') {
      return json({ ok: false, error: 'gate_taken_race' }, 409);
    }
    return json({ ok: false, error: 'insert_failed' }, 500);
  }

  await logEvent(supabaseAdmin, created.id, 'created', {
    hold_id: iyz.paymentId,
    hold_amount_try: cfg.reservation_hold_try,
  });

  return json({ ok: true, reservation: created });
});
