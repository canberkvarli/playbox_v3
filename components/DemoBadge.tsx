import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/theme';
import { useDevStore } from '@/stores/devStore';

/**
 * A small "DEMO" pill pinned top-center whenever Demo Mode is on (reviewer /
 * mock hardware). Non-interactive overlay so it never blocks the UI — just a
 * glance-able reminder that the hardware is simulated.
 */
export function DemoBadge() {
  const insets = useSafeAreaInsets();
  const demoMode = useDevStore((s) => s.demoMode);
  if (!demoMode) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        // Sit BELOW a standard nav bar so it never covers a screen's header
        // title (the station screen centers its name up top).
        position: 'absolute',
        top: insets.top + 52,
        right: 14,
        alignItems: 'flex-end',
        zIndex: 9999,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: palette.danger,
          paddingHorizontal: 12,
          paddingVertical: 4,
          borderRadius: 999,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />
        <Text
          style={{
            color: '#FFFFFF',
            fontFamily: 'JetBrainsMono_700Bold',
            fontSize: 11,
            letterSpacing: 1.5,
          }}
        >
          DEMO
        </Text>
      </View>
    </View>
  );
}
