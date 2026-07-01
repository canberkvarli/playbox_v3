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
import { Wordmark } from '@/components/ui';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DRAWER_W = Math.round(SCREEN_W * 0.86);

const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;
const SAFE_BOTTOM = Platform.OS === 'ios' ? 28 : 16;
const PAD = 24;

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

  // Press-scale for the share tile (local, native-driven).
  const shareScale = useRef(new Animated.Value(1)).current;
  const springShare = (to: number) =>
    Animated.spring(shareScale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 8,
    }).start();

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
    { key: 'reservations', label: 'rezervasyonlar', icon: 'calendar', onPress: () => go('/reservations') },
    { key: 'billing', label: 'ödemeler', icon: 'credit-card', onPress: () => go('/payments') },
  ];

  const translateX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_W, 0],
  });
  const backdropOpacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  // Staggered cascade: each nav row fades + rises in, keyed off the SAME
  // drawer-open value `t`. Later rows start their reveal later in the timeline,
  // so they appear to spring in one after another as the panel slides.
  const rowAnim = (index: number) => {
    const start = 0.25 + index * 0.14;
    const end = Math.min(start + 0.4, 1);
    const inputRange = start < end ? [start, end] : [0, 1];
    const opacity = t.interpolate({
      inputRange,
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
    const translateY = t.interpolate({
      inputRange,
      outputRange: [16, 0],
      extrapolate: 'clamp',
    });
    return { opacity, transform: [{ translateY }] };
  };

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
          backgroundColor: palette.bg,
          borderTopLeftRadius: 32,
          borderBottomLeftRadius: 32,
          borderLeftWidth: 1,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: palette.border,
          shadowColor: '#000',
          shadowOffset: { width: -8, height: 0 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          transform: [{ translateX }],
        }}
      >
        {/* Top bar: wordmark lockup + close-X */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: SAFE_TOP,
            paddingHorizontal: PAD,
            paddingBottom: 18,
          }}
        >
          <Wordmark size={22} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable
              onPress={async () => {
                await hx.tap();
                go('/settings');
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="ayarlar"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="settings" size={19} color={palette.fg} />
            </Pressable>
            <Pressable
              onPress={close}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="kapat"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="x" size={20} color={palette.fg} />
            </Pressable>
          </View>
        </View>

        {/* User card — tap name/avatar → profile; gear → settings */}
        <View style={{ paddingHorizontal: PAD }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: palette.surface,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: palette.border,
              padding: 14,
            }}
          >
            <Pressable
              onPress={() => {
                hx.tap();
                go('/(tabs)/profile');
              }}
              accessibilityRole="button"
              accessibilityLabel={displayName || 'profil'}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: palette.volt,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14,
                }}
              >
                <Text
                  style={{
                    color: palette.voltInk,
                    fontFamily: 'Unbounded_800ExtraBold',
                    fontSize: 20,
                  }}
                >
                  {initial}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: palette.fg,
                    fontFamily: 'Unbounded_700Bold',
                    fontSize: 17,
                    letterSpacing: 0.2,
                  }}
                >
                  {displayName || 'oyuncu'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: palette.muted,
                    fontFamily: 'JetBrainsMono_500Medium',
                    fontSize: 13,
                    marginTop: 4,
                    letterSpacing: 0.2,
                  }}
                >
                  {username ? `@${username}` : 'profilini gör'}
                </Text>
              </View>
              <Feather name="chevron-right" size={22} color={palette.muted} />
            </Pressable>
          </View>
        </View>

        {/* Nav list — big uppercase display labels, cascading entrance */}
        <ScrollView
          style={{
            width: DRAWER_W,
            maxHeight:
              SCREEN_H -
              (SAFE_TOP + 18 + 26) -
              (14 + 52 + 14) -
              (SAFE_BOTTOM + 132),
          }}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: 26, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {ITEMS.map((item, index) => (
            <Animated.View key={item.key} style={rowAnim(index)}>
              <Pressable
                onPress={async () => {
                  await hx.tap();
                  item.onPress();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 15,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 13,
                    backgroundColor: palette.surface,
                    borderWidth: 1,
                    borderColor: palette.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 16,
                  }}
                >
                  <Feather name={item.icon} size={20} color={palette.fg} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: palette.fg,
                    fontFamily: 'Unbounded_800ExtraBold',
                    fontSize: 16,
                    letterSpacing: 0.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>

        {/* Destek — the PROMINENT tile (volt, animated press). */}
        <View
          style={{
            position: 'absolute',
            left: PAD,
            right: PAD,
            bottom: SAFE_BOTTOM + 60,
          }}
        >
          <Animated.View style={{ transform: [{ scale: shareScale }] }}>
            <Pressable
              onPress={async () => {
                await hx.tap();
                go('/support');
              }}
              onPressIn={() => springShare(0.96)}
              onPressOut={() => springShare(1)}
              accessibilityRole="button"
              accessibilityLabel="destek"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: palette.volt,
                borderRadius: 20,
                paddingVertical: 16,
                paddingHorizontal: 18,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 13,
                  backgroundColor: 'rgba(0,0,0,0.10)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14,
                }}
              >
                <Feather name="help-circle" size={20} color={palette.voltInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: palette.voltInk,
                    fontFamily: 'Unbounded_800ExtraBold',
                    fontSize: 16,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}
                >
                  destek
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: palette.voltInk,
                    opacity: 0.7,
                    fontFamily: 'Inter_500Medium',
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  yardıma mı ihtiyacın var?
                </Text>
              </View>
              <Feather name="arrow-right" size={20} color={palette.voltInk} />
            </Pressable>
          </Animated.View>
        </View>

        {/* Share — subtle ghost row, pinned bottom-left. */}
        <View
          style={{
            position: 'absolute',
            left: PAD,
            bottom: SAFE_BOTTOM,
          }}
        >
          <Pressable
            onPress={async () => {
              await hx.tap();
              shareApp();
            }}
            accessibilityRole="button"
            accessibilityLabel="playbox'ı paylaş"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Feather name="share-2" size={16} color={palette.muted} style={{ marginRight: 8 }} />
            <Text
              style={{
                color: palette.muted,
                fontFamily: 'Inter_600SemiBold',
                fontSize: 14,
                letterSpacing: 0.2,
              }}
            >
              playbox'ı paylaş
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
