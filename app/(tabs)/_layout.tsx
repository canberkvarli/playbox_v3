import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, View } from 'react-native';

import { palette } from '@/constants/theme';
import { SportBall } from '@/components/ui/SportBall';
import { useT } from '@/hooks/useT';
import { ActiveSessionBanner } from '@/components/ActiveSessionBanner';
import { MenuDrawer } from '@/components/MenuDrawer';

export default function TabLayout() {
  const { t } = useT();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          // Tabs defaulted to 'none', so harita ↔ oyna ↔ profil cut instantly —
          // the rigid, app-switcher feel. 'shift' slides the outgoing screen out
          // and the incoming one in (in the direction you actually moved along
          // the bar) while cross-fading, which reads as one surface moving
          // rather than three unrelated screens. Set on screenOptions so every
          // tab shares it; a per-tab override would make the motion asymmetric.
          animation: 'shift',
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
            tabBarIcon: ({ color, size }) => (
              <SportBall sport="basketball" color={color as string} size={size + 2} />
            ),
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
