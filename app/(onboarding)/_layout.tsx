import { Stack } from 'expo-router';

import { palette } from '@/constants/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'slide_from_right',
        // Locked to the asphalt bg so the system can't flash the wrong colour
        // during route swaps.
        contentStyle: { backgroundColor: palette.bg },
      }}
    />
  );
}
