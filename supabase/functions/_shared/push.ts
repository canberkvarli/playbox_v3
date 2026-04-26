// @ts-nocheck — Deno runtime
//
// Minimal Expo Push helper. Reads the user's stored expo_token and posts
// to https://exp.host/--/api/v2/push/send. Failures are non-blocking —
// notifications are convenience, not load-bearing for the reservation
// state machine.
//
// Caller passes the service-role supabase client (we read user_push_tokens
// for an arbitrary user, which would otherwise be denied by RLS).

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export async function sendPush(
  supabaseAdmin,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from('user_push_tokens')
      .select('expo_token')
      .eq('user_id', userId)
      .maybeSingle();
    if (!row?.expo_token) return;

    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: row.expo_token,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: 'default',
      }),
    });
  } catch (e) {
    console.warn('[push] send failed (non-blocking)', { userId, e });
  }
}
