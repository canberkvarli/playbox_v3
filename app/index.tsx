import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useDevStore } from '@/stores/devStore';

export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const devBypass = useDevStore((s) => s.bypass);

  if (__DEV__ && devBypass) {
    return <Redirect href="/(tabs)/map" />;
  }
  if (!isLoaded) return null;
  return <Redirect href={isSignedIn ? '/(tabs)/map' : '/(onboarding)/welcome'} />;
}
