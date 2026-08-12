import { Redirect } from 'expo-router';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useDevStore } from '@/stores/devStore';
import { useSessionStore } from '@/stores/sessionStore';

export default function Index() {
  const { session, loading } = useAuthSession();
  const devBypass = useDevStore((s) => s.bypass);
  const activeSession = useSessionStore((s) => s.active);

  // Dev bypass — skip auth. Still respect the active-session priority so
  // dev sessions also resume to /play.
  if (__DEV__ && devBypass) {
    return <Redirect href={activeSession ? '/(tabs)/play' : '/(tabs)/map'} />;
  }

  // Wait for Supabase to rehydrate the session from AsyncStorage
  if (loading) return null;

  // Anonymous → onboarding
  if (!session) return <Redirect href="/(onboarding)/welcome" />;

  // Authenticated AND mid-session → go straight to the timer. Otherwise
  // KVKK/handle gates need to land on map; the screens themselves handle
  // pushing further if onboarding metadata is missing.
  if (activeSession) return <Redirect href="/(tabs)/play" />;
  return <Redirect href="/(tabs)/map" />;
}
