import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

export default function OnboardingLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.bg },
      }}
    />
  );
}
