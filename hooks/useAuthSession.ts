import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setUser as setTelemetryUser } from '@/lib/telemetry';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setTelemetryUser(data.session?.user ? { id: data.session.user.id } : null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
      // Keep telemetry user identity in sync with auth — sign-out clears it
      // so future errors aren't misattributed to the previous user.
      setTelemetryUser(s?.user ? { id: s.user.id } : null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const user: User | null = session?.user ?? null;
  return { session, user, loading };
}
