// @ts-nocheck — Deno runtime
//
// delete-account
// KVKK / right-to-erasure: removes the caller's account and all derived
// records, plus tells Iyzico to drop the stored card.
//
// Order of operations matters because of foreign-key cascades and
// external-state cleanups:
//
//   1. Iyzico card delete  — best-effort, never blocks user deletion
//   2. PG row deletes      — every user-scoped table (reservation_events
//                            cascades from reservations.id automatically)
//   3. auth.admin.deleteUser() last — so a partial failure leaves the user
//                            able to sign back in and retry rather than
//                            orphaned with no auth row
//
// Errors at each step are logged but do NOT propagate to the client. The
// user has clicked "delete my account" and we owe them follow-through;
// support cleans up anything that didn't land via the dashboard.
//
// Deploy with:
//   npx supabase functions deploy delete-account
//
// Required env (set via dashboard → Edge Functions → Settings):
//   SUPABASE_URL                - autopopulated
//   SUPABASE_ANON_KEY           - autopopulated
//   SUPABASE_SERVICE_ROLE_KEY   - set manually, NEVER commit
//   IYZICO_API_KEY              - already set for other iyzico-* fns
//   IYZICO_SECRET_KEY           - already set for other iyzico-* fns
//   IYZICO_BASE_URL             - already set for other iyzico-* fns
//
// Request:  {} (user identified by JWT)
// Success:  { ok: true, deleted: { ... per-table flags } }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { handleOptions, json } from '../_shared/cors.ts';
import { getBearerToken, getUserIdFromRequest } from '../_shared/auth.ts';
import { checkEnv, deleteCard as iyzicoDeleteCard } from '../_shared/iyzico.ts';

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const userId = getUserIdFromRequest(req);
  const jwt = getBearerToken(req);
  if (!userId || !jwt) return json({ ok: false, error: 'unauthorized' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: 'service_role_missing' }, 500);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const result: Record<string, boolean | string> = {};

  // 1. Iyzico card removal — only if there's a stored card and Iyzico is
  //    configured. Either condition missing is fine, just record why.
  const envCheck = checkEnv();
  if (envCheck.ok) {
    const { data: card } = await supabaseAdmin
      .from('user_cards')
      .select('iyzico_card_user_key, iyzico_card_token')
      .eq('user_id', userId)
      .maybeSingle();
    if (card?.iyzico_card_user_key && card?.iyzico_card_token) {
      try {
        const iyz = await iyzicoDeleteCard({
          locale: 'tr',
          conversationId: `delete-account:${userId}:${Date.now()}`,
          cardUserKey: card.iyzico_card_user_key,
          cardToken: card.iyzico_card_token,
        });
        result.iyzico_card = iyz.status === 'success';
        if (iyz.status !== 'success') {
          console.warn('[delete-account] iyzico delete failed (non-blocking)', { userId, iyz });
        }
      } catch (e) {
        console.warn('[delete-account] iyzico delete threw (non-blocking)', { userId, e });
        result.iyzico_card = false;
      }
    } else {
      result.iyzico_card = 'no_card_on_file';
    }
  } else {
    result.iyzico_card = 'iyzico_not_configured';
  }

  // 2. PG row deletes. Each is best-effort; failures are logged but don't
  //    abort. Order is irrelevant because we use service role (RLS bypassed)
  //    and reservation_events cascades from reservations.id automatically.
  const tables: Array<{ table: string; key: string }> = [
    { table: 'reservations', key: 'user_id' },
    { table: 'user_reservation_locks', key: 'user_id' },
    { table: 'terms_acceptances', key: 'user_id' },
    { table: 'user_push_tokens', key: 'user_id' },
    { table: 'user_cards', key: 'user_id' },
  ];
  for (const t of tables) {
    const { error } = await supabaseAdmin.from(t.table).delete().eq(t.key, userId);
    if (error) {
      console.error('[delete-account] table delete failed', { userId, table: t.table, error });
      result[t.table] = false;
    } else {
      result[t.table] = true;
    }
  }

  // 3. Auth row last. If it fails, all PII is already gone — support can
  //    clean up the orphaned auth row from the dashboard.
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('[delete-account] auth delete failed', { userId, error });
      result.auth_user = false;
    } else {
      result.auth_user = true;
    }
  } catch (e) {
    console.error('[delete-account] auth delete threw', { userId, e });
    result.auth_user = false;
  }

  return json({ ok: true, deleted: result });
});
