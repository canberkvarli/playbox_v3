import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, View, type ColorValue } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { palette } from '@/constants/theme';
import { useT } from '@/hooks/useT';
import { useSessionStore } from '@/stores/sessionStore';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { ActiveSessionBanner } from '@/components/ActiveSessionBanner';
import { MenuDrawer } from '@/components/MenuDrawer';

/**
 * Play tab icon that GLOWS with a soft pulsing volt halo while a session is
 * active, so the user always sees there's a live session to return to. Colours
 * stay in JS (theme accent); the worklet only animates opacity + scale.
 */
function PlayTabIcon({ color, size }: { color: ColorValue; size: number }) {
  const active = useSessionStore((s) => s.active);
  const reduceMotion = useReduceMotion();
  const glow = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(glow);
      glow.value = 0;
      return;
    }
    if (reduceMotion) {
      cancelAnimation(glow);
      glow.value = 0.6; // steady halo instead of a pulse
      return;
    }
    glow.value = 0;
    glow.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(glow);
  }, [active, reduceMotion, glow]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + glow.value * 0.5,
    transform: [{ scale: 0.85 + glow.value * 0.4 }],
  }));

  const box = size + 16;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: box - 2,
              height: box - 2,
              borderRadius: box / 2,
              backgroundColor: palette.volt,
            },
            haloStyle,
          ]}
        />
      ) : null}
      <Feather name="play" size={size} color={active ? palette.volt : color} />
    </View>
  );
}

export default function TabLayout() {
  const { t } = useT();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: palette.volt,
          tabBarInactiveTintColor: palette.muted,
          // Asphalt Volt tab bar: dark surface + hairline top, volt active tint.
          tabBarStyle: {
            backgroundColor: palette.surface,
            borderTopColor: palette.border,
            borderTopWidth: 1,
          },
          tabBarLabelStyle: {
            fontFamily: 'Inter_500Medium',
            fontSize: 11,
            letterSpacing: 0.3,
            textTransform: 'lowercase',
          },
        }}
      >
        <Tabs.Screen
          name="map"
          options={{
            title: t('tabs.map'),
            tabBarIcon: ({ color, size }) => <Feather name="map" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="play"
          options={{
            title: t('tabs.play'),
            tabBarIcon: ({ color, size }) => <PlayTabIcon color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile'),
            tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
          }}
        />
      </Tabs>
      <ActiveSessionBanner />
      <MenuDrawer />
    </View>
  );
}
