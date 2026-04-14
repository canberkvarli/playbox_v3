import '../global.css';
import '../i18n';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { ClerkProvider } from '@clerk/clerk-expo';

import { useColorScheme } from '@/hooks/useColorScheme';
import { useLoadedFonts } from '@/hooks/useLoadedFonts';
import { tokenCache } from '@/lib/clerk-token-cache';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
if (!publishableKey && __DEV__) {
  console.warn(
    '[playbox] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. ' +
    'Auth calls will fail until you add it to .env.local (see .env.example). ' +
    'UI work (onboarding visuals, map, tabs) will still render.'
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { loaded, error } = useLoadedFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (error) {
      console.warn('Font loading error:', error);
    }
  }, [error]);

  if (!loaded && !error) return null;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </ClerkProvider>
  );
}
