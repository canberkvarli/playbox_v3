import '../global.css';
import '../i18n';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/useColorScheme';
import { useLoadedFonts } from '@/hooks/useLoadedFonts';
import { usePushToken } from '@/hooks/usePushToken';
import { supabase } from '@/lib/supabase';
import { ErrorBoundary as AppErrorBoundary } from '@/components/ErrorBoundary';
import { initTelemetry } from '@/lib/telemetry';

export { ErrorBoundary } from 'expo-router';

// One-shot telemetry init at module evaluation. Idempotent — safe to call
// on every reload during dev.
initTelemetry();

SplashScreen.preventAutoHideAsync();

// Keep the Supabase session refreshing while the app is foregrounded; pause
// when backgrounded so we're not burning battery on token refreshes.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { loaded, error } = useLoadedFonts();

  // Register the Expo push token once permissions land. Best-effort,
  // skipped on simulators and non-granted permissions.
  usePushToken();

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="station/[id]"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="session-prep/[stationId]/[sport]"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="scan"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="settings"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="session-review"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="card-add"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="payments"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="support"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="reservations"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="reserve/[stationId]/[sport]/[gateId]"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="legal/privacy"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="legal/terms"
              options={{ headerShown: false, presentation: 'card', animation: 'slide_from_right' }}
            />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}
