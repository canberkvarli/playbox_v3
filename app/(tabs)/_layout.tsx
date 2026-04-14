import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform } from 'react-native';

import { palette } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.coral,
        tabBarInactiveTintColor: palette.mauve,
        tabBarStyle: {
          backgroundColor: palette.paper,
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
          title: 'harita',
          tabBarIcon: ({ color, size }) => <Feather name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="play"
        options={{
          title: 'oyna',
          tabBarIcon: ({ color, size }) => <Feather name="play-circle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'profil',
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
