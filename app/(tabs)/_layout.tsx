import { Tabs, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { useT } from '@/hooks/useT';
import { useDevStore } from '@/stores/devStore';
import { hx } from '@/lib/haptics';

function DevBadge() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const bypass = useDevStore((s) => s.bypass);
  const setBypass = useDevStore((s) => s.setBypass);
  if (!__DEV__ || !bypass) return null;
  return (
    <Pressable
      onPress={async () => {
        await hx.tap();
        setBypass(false);
        router.replace('/(onboarding)/welcome');
      }}
      style={{
        position: 'absolute',
        top: insets.top + 8,
        right: 12,
        zIndex: 999,
        backgroundColor: theme.fg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
      }}
      hitSlop={8}
    >
      <Text className="font-mono text-paper dark:text-ink text-xs">DEV</Text>
    </Pressable>
  );
}

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
      <DevBadge />
    </View>
  );
}
