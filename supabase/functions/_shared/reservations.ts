// @ts-nocheck — Deno runtime
//
// Shared helpers for the reservation Edge Functions.
//
// All callers must already have:
//   - validated the JWT and extracted userId
//   - constructed a service-role Supabase client (we need to bypass RLS to
//     write to reservations / locks / events).

export type AppConfig = {
  reservation_hold_try: number;
  reservation_lock_min: number;
  grace_seconds: number;
  terms_version: number;
  velocity_per_hour: number;
  velocity_per_day: number;
  tier1_captures: number;
  tier1_window_days: number;
  tier1_lock_hours: number;
  tier2_captures: number;
  tier2_window_days: number;
  tier2_lock_days: number;
  tier3_captures: number;
  tier3_window_days: number;
};

export async function getAppConfig(supabaseAdmin): Promise<AppConfig> {
  const { data, error } = await supabaseAdmin.from('app_config').select('key, value');
  if (error || !data) {
    throw new Error(`app_config read failed: ${error?.message ?? 'no rows'}`);
  }
  const map: Record<string, unknown> = {};
  for (const row of data) map[row.key] = row.value;
  return map as AppConfig;
}

export async function logEvent(
  supabaseAdmin,
  reservationId: string,
  kind: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.from('reservation_events').insert({
    reservation_id: reservationId,
    kind,
    payload: payload ?? null,
  });
}

// Severity ranking for locks. Higher number = more severe = wins on conflict.
const SEVERITY: Record<string, number> = {
  tier_24h: 1,
  tier_7d: 2,
  payment_failed: 3,
  manual_review: 4,
};

/**
 * Counts captures in the configured windows and applies the appropriate
 * lock if a tier threshold is crossed. Never downgrades an existing lock.
 *
 * Returns the reason string of the lock that ended up on the user (existing
 * or new), or null if no lock is active.
 */
export async function applyTierLockIfNeeded(
  supabaseAdmin,
  userId: string,
  cfg: AppConfig,
  triggeredById: string,
): Promise<string | null> {
  const since30 = new Date(Date.now() - cfg.tier1_window_days * 86400 * 1000).toISOString();
  const since90 = new Date(Date.now() - cfg.tier3_window_days * 86400 * 1000).toISOString();

  const [{ count: count30 }, { count: count90 }] = await Promise.all([
    supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'expired_captured')
      .gte('terminal_at', since30),
    supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'expired_captured')
      .gte('terminal_at', since90),
  ]);

  let newLock: { reason: string; locked_until: string } | null = null;
  if ((count90 ?? 0) >= cfg.tier3_captures) {
    newLock = { reason: 'manual_review', locked_until: 'infinity' };
  } else if ((count30 ?? 0) >= cfg.tier2_captures) {
    newLock = {
      reason: 'tier_7d',
      locked_until: new Date(Date.now() + cfg.tier2_lock_days * 86400 * 1000).toISOString(),
    };
  } else if ((count30 ?? 0) >= cfg.tier1_captures) {
    newLock = {
      reason: 'tier_24h',
      locked_until: new Date(Date.now() + cfg.tier1_lock_hours * 3600 * 1000).toISOString(),
    };
  }

  if (!newLock) {
    // No new lock to apply. Return whatever existing lock is still active.
    const { data: existing } = await supabaseAdmin
      .from('user_reservation_locks')
      .select('reason, locked_until')
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing) return null;
    const stillActive =
      existing.locked_until === 'infinity' ||
      new Date(existing.locked_until).getTime() > Date.now();
    return stillActive ? existing.reason : null;
  }

  const { data: existing } = await supabaseAdmin
    .from('user_reservation_locks')
    .select('reason, locked_until')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const existingSev = SEVERITY[existing.reason] ?? 0;
    const newSev = SEVERITY[newLock.reason] ?? 0;
    if (existingSev >= newSev) return existing.reason;
  }

  await supabaseAdmin.from('user_reservation_locks').upsert(
    {
      user_id: userId,
      reason: newLock.reason,
      locked_until: newLock.locked_until,
      triggered_by_id: triggeredById,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  await logEvent(supabaseAdmin, triggeredById, 'tier_lock_triggered', {
    reason: newLock.reason,
    locked_until: newLock.locked_until,
    captures_30d: count30 ?? 0,
    captures_90d: count90 ?? 0,
  });

  return newLock.reason;
}

/**
 * Returns the active lock for the user, or null. Treats `infinity` and
 * future `locked_until` both as active.
 */
export async function getActiveLock(supabaseAdmin, userId: string) {
  const { data } = await supabaseAdmin
    .from('user_reservation_locks')
    .select('reason, locked_until, triggered_by_id, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const active =
    data.locked_until === 'infinity' || new Date(data.locked_until).getTime() > Date.now();
  return active ? data : null;
}
