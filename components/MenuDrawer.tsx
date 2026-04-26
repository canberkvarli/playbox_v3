import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useMenuStore } from '@/stores/menuStore';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DRAWER_W = Math.round(SCREEN_W * 0.86);

const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;
const SAFE_BOTTOM = Platform.OS === 'ios' ? 28 : 16;
const ROW_H = 56;

type Item = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void | Promise<void>;
};

export function MenuDrawer() {
  const open = useMenuStore((s) => s.open);
  const setOpen = useMenuStore((s) => s.setOpen);
  const router = useRouter();
  const { displayName, username, initial } = useDisplayUser();

  // Plain RN Animated — no reanimated, no worklets, no version-mismatch risk
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, t]);

  const close = () => setOpen(false);
  const go = (href: string) => {
    setOpen(false);
    setTimeout(() => router.push(href as never), 80);
  };

  const shareApp = async () => {
    await hx.tap();
    try {
      await Share.share({
        message: 'Playbox — şehrin her yerinde spor ekipmanı. https://playbox.app',
      });
    } catch {}
  };

  const ITEMS: Item[] = [
    { key: 'map', label: 'harita', icon: 'map', onPress: () => go('/(tabs)/map') },
    { key: 'profile', label: 'profil', icon: 'user', onPress: () => go('/(tabs)/profile') },
    { key: 'settings', label: 'ayarlar', icon: 'settings', onPress: () => go('/settings') },
    { key: 'reservations', label: 'rezervasyonlar', icon: 'calendar', onPress: () => go('/reservations') },
    { key: 'billing', label: 'ödemeler', icon: 'credit-card', onPress: () => go('/payments') },
    { key: 'share', label: "playbox'ı paylaş", icon: 'share-2', onPress: shareApp },
  ];

  const translateX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_W, 0],
  });
  const backdropOpacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        zIndex: 9999,
        elevation: 9999,
      }}
    >
      {/* Backdrop */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: SCREEN_W,
          height: SCREEN_H,
          backgroundColor: '#000',
          opacity: backdropOpacity,
        }}
      >
        <Pressable style={{ width: '100%', height: '100%' }} onPress={close} />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: DRAWER_W,
          height: SCREEN_H,
          backgroundColor: palette.paper,
          borderTopLeftRadius: 28,
          borderBottomLeftRadius: 28,
          shadowColor: '#000',
          shadowOffset: { width: -8, height: 0 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          transform: [{ translateX }],
        }}
      >
        {/* Top close-X bar */}
        <View
          style={{
            width: DRAWER_W,
            height: SAFE_TOP + 12,
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'flex-end',
            paddingRight: 16,
            paddingBottom: 4,
          }}
        >
          <Pressable
            onPress={close}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="kapat"
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: '#572c5712',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="x" size={20} color={palette.ink} />
          </Pressable>
        </View>

        {/* Header — same inner-View pattern as the menu items so the row
            layout actually applies. */}
        <Pressable
          onPress={() => {
            hx.tap();
            go('/(tabs)/profile');
          }}
          accessibilityRole="button"
          accessibilityLabel={displayName}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: DRAWER_W,
              height: 84,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 20,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: palette.ink,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
              }}
            >
              <Text
                style={{
                  color: palette.paper,
                  fontSize: 20,
                  fontWeight: '800',
                }}
              >
                {initial}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: palette.ink,
                  fontSize: 18,
                  fontWeight: '700',
                  letterSpacing: 0.2,
                }}
              >
                {displayName}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  color: palette.ink,
                  fontSize: 13,
                  marginTop: 3,
                  letterSpacing: 0.2,
                  fontWeight: '700',
                }}
              >
                @{username}
              </Text>
            </View>
          </View>
        </Pressable>

        <View
          style={{
            width: DRAWER_W - 40,
            marginLeft: 20,
            height: 1,
            backgroundColor: '#572c5714',
          }}
        />

        {/* Items list — fixed maxHeight so destek footer always fits */}
        <ScrollView
          style={{
            width: DRAWER_W,
            maxHeight:
              SCREEN_H -
              (SAFE_TOP + 12) -
              80 -
              1 -
              (1 + ROW_H + SAFE_BOTTOM),
          }}
          contentContainerStyle={{ paddingVertical: 6 }}
          showsVerticalScrollIndicator={false}
        >
          {ITEMS.map((item) => (
            <Pressable
              key={item.key}
              onPress={async () => {
                await hx.tap();
                item.onPress();
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
            >
              <View
                style={{
                  width: DRAWER_W,
                  height: ROW_H,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 22,
                }}
              >
                <Feather
                  name={item.icon}
                  size={22}
                  color={palette.ink}
                  style={{ marginRight: 14 }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: palette.ink,
                    fontSize: 17,
                    fontWeight: '600',
                  }}
                >
                  {item.label}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Destek footer — absolutely pinned to the bottom of the panel */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: SAFE_BOTTOM,
            width: DRAWER_W,
          }}
        >
          <View
            style={{
              width: DRAWER_W - 40,
              marginLeft: 20,
              height: 1,
              backgroundColor: '#572c5714',
            }}
          />
          <Pressable
            onPress={async () => {
              await hx.tap();
              go('/support');
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          >
            <View
              style={{
                width: DRAWER_W,
                height: 72,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 22,
              }}
            >
              <Feather
                name="phone"
                size={26}
                color={palette.coral}
                style={{ marginRight: 16 }}
              />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: palette.coral,
                  fontSize: 20,
                  fontWeight: '800',
                  letterSpacing: 0.2,
                }}
              >
                destek
              </Text>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
