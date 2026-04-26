// Supabase Edge Function: delete-account
//
// Deletes the calling user's account using the service-role admin API. The
// client app calls this with its user JWT; we verify the JWT, then call
// `admin.deleteUser()` with the service-role key (which is NEVER exposed to
// the client).
//
// Deploy with:
//   supabase functions deploy delete-account
//
// Required env (set via `supabase secrets set --env-file ./supabase/.env`):
//   SUPABASE_URL              — autopopulated in Edge runtime
//   SUPABASE_ANON_KEY         — autopopulated in Edge runtime
//   SUPABASE_SERVICE_ROLE_KEY — set this manually, NEVER commit it
//
// The user's auth JWT comes from the Authorization: Bearer header. We use
// the anon-key client to identify the caller, then a service-role client to
// actually delete them.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. Identify the caller using their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: getUserErr } = await userClient.auth.getUser();
    if (getUserErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Delete the user with the service-role admin client.
    const admin = createClient(supabaseUrl, serviceKey);
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error('[delete-account] deleteUser failed', deleteErr);
      return new Response(
        JSON.stringify({ ok: false, error: 'delete_failed', message: deleteErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. (Optional) Cascade-clean rows in your own tables. RLS won't help
    //    once auth.users is gone, so any FK references should ON DELETE
    //    CASCADE. If you have non-FK soft-delete tables, scrub them here.
    //
    //    await admin.from('sessions').delete().eq('user_id', user.id);
    //    await admin.from('payments').delete().eq('user_id', user.id);
    //    await admin.from('reservations').delete().eq('user_id', user.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[delete-account] unexpected', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'unexpected', message: String(e) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
