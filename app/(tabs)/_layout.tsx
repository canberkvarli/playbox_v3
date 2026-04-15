import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, View } from 'react-native';

import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { useT } from '@/hooks/useT';

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
          tabBarStyle: {
            backgroundColor: theme.bg,
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
            height: Platform.OS === 'ios' ? 84 : 64,
            paddingTop: 8,
          },
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
            title: t('tabs.play'),
            tabBarIcon: ({ color, size }) => <Feather name="play-circle" size={size} color={color} />,
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
    </View>
  );
}
