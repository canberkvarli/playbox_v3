import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, View } from 'react-native';

import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { useT } from '@/hooks/useT';
import { ActiveSessionBanner } from '@/components/ActiveSessionBanner';
import { MenuDrawer } from '@/components/MenuDrawer';

export default function TabLayout() {
  const { t } = useT();
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: palette.coral,
          tabBarInactiveTintColor: palette.mauve,
          tabBarStyle: { display: 'none' },
          tabBarLabelStyle: {
            fontFamily: 'Inter_500Medium',
            fontSize: 11,
            letterSpacing: 0.3,
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
            // Hidden from tab bar — accessible via ActiveSessionBanner only.
            href: null,
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
