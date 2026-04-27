// @ts-nocheck — Deno runtime
//
// otp-precheck
// Soft throttle in front of Supabase OTP / Twilio Verify. The client
// MUST call this before invoking supabase.auth.signInWithOtp(); on
// `ok: true` the client proceeds to the actual OTP request, otherwise
// it surfaces a localized "too many tries" message.
//
// This is a pre-auth call — the user is by definition anonymous when
// requesting their first SMS, so there's no JWT to verify. Deploy with:
//
//   npx supabase functions deploy otp-precheck --no-verify-jwt
//
// The function authenticates with the service role internally so RLS
// (which excludes anonymous role) does not block the throttle log.
//
// Hole-in-the-fence honesty: a malicious client can skip this call and
// hit signInWithOtp directly. To close that hole tightly, also tune
// Supabase Auth's built-in rate limits (Dashboard → Authentication →
// Rate Limits) and Twilio Verify's per-recipient cooldown.
//
// Limits (soft, room for honest typos):
//   per phone, 1h:   5
//   per phone, 24h:  15
//   per IP, 1h:      10
//
// Request:  { phone }                     // E.164, e.g. "+905551234567"
// Success:  { ok: true }
// Throttle: { ok: false, error: 'throttled_phone' | 'throttled_ip', retry_after_seconds }
// Error:    { ok: false, error: 'invalid_phone' | 'service_role_missing' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';

const PHONE_PER_HOUR = 5;
const PHONE_PER_DAY = 15;
const IP_PER_HOUR = 10;

// E.164 validation: + sign followed by 7-15 digits.
const E164 = /^\+[1-9]\d{6,14}$/;

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_phone' }, 400);
  }
  const phone = String(body.phone ?? '').trim();
  if (!E164.test(phone)) {
    return json({ ok: false, error: 'invalid_phone' }, 400);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString();

  const [phoneHourQ, phoneDayQ, ipHourQ] = await Promise.all([
    supabaseAdmin
      .from('phone_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('phone_e164', phone)
      .eq('outcome', 'sent')
      .gte('attempted_at', oneHourAgo),
    supabaseAdmin
      .from('phone_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('phone_e164', phone)
      .eq('outcome', 'sent')
      .gte('attempted_at', oneDayAgo),
    ip
      ? supabaseAdmin
          .from('phone_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip', ip)
          .eq('outcome', 'sent')
          .gte('attempted_at', oneHourAgo)
      : Promise.resolve({ count: 0 }),
  ]);

  const phoneHour = phoneHourQ.count ?? 0;
  const phoneDay = phoneDayQ.count ?? 0;
  const ipHour = ipHourQ.count ?? 0;

  // Soft retry estimate: time until the oldest attempt in the offending
  // window falls off. For simplicity we return one hour for hour-scoped
  // throttles and one day for day-scoped.
  if (phoneHour >= PHONE_PER_HOUR) {
    await supabaseAdmin.from('phone_attempts').insert({
      phone_e164: phone,
      ip,
      outcome: 'throttled_phone',
    });
    return json(
      { ok: false, error: 'throttled_phone', retry_after_seconds: 3600 },
      429,
    );
  }
  if (phoneDay >= PHONE_PER_DAY) {
    await supabaseAdmin.from('phone_attempts').insert({
      phone_e164: phone,
      ip,
      outcome: 'throttled_phone',
    });
    return json(
      { ok: false, error: 'throttled_phone', retry_after_seconds: 86400 },
      429,
    );
  }
  if (ipHour >= IP_PER_HOUR) {
    await supabaseAdmin.from('phone_attempts').insert({
      phone_e164: phone,
      ip,
      outcome: 'throttled_ip',
    });
    return json(
      { ok: false, error: 'throttled_ip', retry_after_seconds: 3600 },
      429,
    );
  }

  // Permit. Record the intent to send so the next call sees this attempt.
  // We log `outcome: 'sent'` optimistically — if the client never gets to
  // signInWithOtp, the limit is still a fair upper bound on send attempts.
  await supabaseAdmin.from('phone_attempts').insert({
    phone_e164: phone,
    ip,
    outcome: 'sent',
  });

  // Lazy retention sweep: occasionally trim rows older than 30 days.
  // ~5% of calls trigger to amortize cost without needing a separate cron.
  if (Math.random() < 0.05) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    await supabaseAdmin
      .from('phone_attempts')
      .delete()
      .lt('attempted_at', thirtyDaysAgo);
  }

  return json({ ok: true });
});
