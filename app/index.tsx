import { Redirect } from 'expo-router';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useDevStore } from '@/stores/devStore';

export default function Index() {
  const { session, loading } = useAuthSession();
  const devBypass = useDevStore((s) => s.bypass);

  // Dev bypass — skip auth, go straight to map
  if (__DEV__ && devBypass) {
    return <Redirect href="/(tabs)/map" />;
  }

  // Wait for Supabase to rehydrate the session from AsyncStorage
  if (loading) return null;

  return <Redirect href={session ? '/(tabs)/map' : '/(onboarding)/welcome'} />;
}
