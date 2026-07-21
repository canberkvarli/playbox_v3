import '../global.css';
import '../i18n';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, ThemeProvider, DefaultTheme, DarkTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/useColorScheme';
import { applyScheme } from '@/constants/theme';
import { useLoadedFonts } from '@/hooks/useLoadedFonts';
import { usePushToken } from '@/hooks/usePushToken';
import { useOtaAutoUpdate } from '@/hooks/useOtaAutoUpdate';
import { useConnectionPresence } from '@/hooks/useConnectionPresence';
import { useReviewerDemo } from '@/hooks/useReviewerDemo';
import { supabase } from '@/lib/supabase';
import { ErrorBoundary as AppErrorBoundary } from '@/components/ErrorBoundary';
import { DemoBadge } from '@/components/DemoBadge';
import { initTelemetry } from '@/lib/telemetry';
import { useColdLaunchReattach } from '@/lib/hardware/useColdLaunchReattach';
// Side-effect: statically loads lib/liveActivity → the widget files, so
// createLiveActivity/createWidget RUN at bundle load. The widget extension runs
// this same bundle; without this the components stay unregistered → empty box.
import '@/lib/liveActivity';

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
  // Sync the mutable `palette` singleton to the active scheme every render
  // (cheap Object.assign). The `key={colorScheme}` on the tree below forces a
  // remount when the scheme flips so the ~980 static `palette.X` reads refresh.
  applyScheme(colorScheme);
  const { loaded, error } = useLoadedFonts();

  // Register the Expo push token once permissions land. Best-effort,
  // skipped on simulators and non-granted permissions.
  usePushToken();

  // Silent OTA: on cold launch, pull + apply any available JS update so the
  // user lands on the latest without the Settings button or a double relaunch.
  // No-op in dev; safe because runtimeVersion is fingerprint-pinned.
  useOtaAutoUpdate();

  // Keep a connected station marked present (a peripheral stops advertising
  // while we hold a GATT connection, so the passive scan can't see it). Read +
  // store-write only, no radio work — safe to run app-wide.
  useConnectionPresence();

  // App Store review account → auto-enable Demo Mode (mock hardware) so Apple
  // can test the full flow without a physical locker.
  useReviewerDemo();

  // Cold-launch recovery: if the app was killed mid-session, re-open the BLE
  // EVENTS subscription for the still-active persisted session so an incoming
  // `gate_closed` can still auto-confirm the return. Resubscribe-only,
  // idempotent, best-effort. See useColdLaunchReattach for details.
  useColdLaunchReattach();

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
    <GestureHandlerRootView key={colorScheme} style={{ flex: 1 }}>
      <AppErrorBoundary>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="station/[id]"
              // gestureEnabled:false — this screen has the horizontal DURATION
              // SLIDER, and the native iOS swipe-back gesture was hijacking the
              // slider drag ("sliding duration swipes the screen"). The JS
              // PanResponder in DurationSlider can't out-prioritize the native
              // back-swipe, so we disable swipe-back here; the header back button
              // still navigates back. Vertical scroll is unaffected.
              options={{
                headerShown: false,
                presentation: 'card',
                animation: 'slide_from_right',
                gestureEnabled: false,
              }}
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
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <DemoBadge />
        </ThemeProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}
