import { Redirect } from 'expo-router';

// TODO(Task 9): replace with Clerk's useAuth().isSignedIn
const isSignedIn = false;

export default function Index() {
  return <Redirect href={isSignedIn ? '/(tabs)/map' : '/(onboarding)/welcome'} />;
}
