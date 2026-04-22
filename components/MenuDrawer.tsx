import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Feather } from '@expo/vector-icons';
import { Dimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.88;
// Spring that settles in ~280ms with no bounce — "silky native" feel.
const DRAWER_SPRING = { damping: 22, stiffness: 200, mass: 0.7 } as const;

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useMenuStore } from '@/stores/menuStore';

type Item = {
  key: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  href?: string;
  external?: string;
  soon?: boolean;
};

const ITEMS: Item[] = [
  { key: 'map', icon: 'map', href: '/(tabs)/map' },
  { key: 'profile', icon: 'user', href: '/(tabs)/profile' },
  { key: 'settings', icon: 'settings', href: '/settings' },
  { key: 'reservations', icon: 'calendar', soon: true },
  { key: 'billing', icon: 'credit-card', soon: true },
  { key: 'safety', icon: 'shield', soon: true },
];

const SUPPORT_ITEM: Item = { key: 'support', icon: 'life-buoy', soon: true };

export function MenuDrawer() {
  const open = useMenuStore((s) => s.open);
  const setOpen = useMenuStore((s) => s.setOpen);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const router = useRouter();
  const { displayName, username, initial } = useDisplayUser();

  const progress = useSharedValue(0);
  // Keep the Modal mounted while the spring slides the drawer out — without
  // this, RN's Modal unmounts as soon as `open` flips and the exit animation
  // never gets to play. Result: drawer appears to close instantly.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withSpring(1, DRAWER_SPRING);
    } else if (mounted) {
      progress.value = withSpring(0, DRAWER_SPRING, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [open, mounted, progress]);

  const sheetStyle = useAnimatedStyle(() => ({
    // Translate by the real drawer width so the edge kisses the screen edge
    // regardless of device size. Using a hardcoded 420 was sloppy.
    transform: [{ translateX: (1 - progress.value) * DRAWER_WIDTH }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.5,
  }));

  const close = () => setOpen(false);

  const onPickItem = async (item: Item) => {
    await hx.tap();
    if (item.href) {
      // Navigate immediately; the drawer slides out under the new route.
      // Feels snappier than "animate then navigate" and avoids a visible pause.
      router.push(item.href as never);
      setOpen(false);
      return;
    }
    if (item.external) {
      close();
      WebBrowser.openBrowserAsync(item.external).catch(() => {});
      return;
    }
    if (item.soon) {
      // No-op for now — could surface a toast lib later
      close();
    }
  };

  const onPressHeader = async () => {
    await hx.tap();
    router.push('/(tabs)/profile');
    setOpen(false);
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
          backdropStyle,
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={close} />
      </Animated.View>

      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: '88%',
            backgroundColor: theme.bg,
            borderTopLeftRadius: 32,
            borderBottomLeftRadius: 32,
            paddingTop: insets.top + 18,
            paddingBottom: insets.bottom + 16,
            shadowColor: '#000',
            shadowOffset: { width: -10, height: 0 },
            shadowOpacity: 0.18,
            shadowRadius: 24,
            elevation: 16,
          },
          sheetStyle,
        ]}
      >
        {/* Top row — avatar, name, close X on one horizontal grid.
            Uses the same paddingHorizontal (20) as every item row below, so
            everything lines up on the same left/right gutters. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            marginBottom: 28,
            gap: 12,
          }}
        >
          <Pressable
            onPress={onPressHeader}
            accessibilityRole="button"
            accessibilityLabel={displayName}
            hitSlop={6}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: palette.mauve,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{ fontFamily: 'Unbounded_800ExtraBold', color: palette.paper, fontSize: 20 }}
              >
                {initial}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: theme.fg,
                  fontSize: 17,
                  letterSpacing: 0.2,
                  includeFontPadding: false,
                }}
              >
                {displayName}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  color: theme.fg + '88',
                  fontSize: 12,
                  marginTop: 3,
                }}
              >
                @{username}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={close}
            hitSlop={10}
            accessibilityLabel={t('common.cancel')}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.fg + '0d',
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <Feather name="x" size={18} color={theme.fg} />
          </Pressable>
        </View>

        {/* Items — same paddingHorizontal (20) + icon column (32) as the header,
            so avatar / icons / support all align on one vertical grid. */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
        >
          {ITEMS.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => onPickItem(item)}
              style={({ pressed }) => ({
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                opacity: pressed ? 0.5 : item.soon ? 0.55 : 1,
              })}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name={item.icon} size={22} color={theme.fg + 'bb'} />
              </View>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{
                  flex: 1,
                  fontFamily: 'Unbounded_700Bold',
                  color: theme.fg,
                  fontSize: 19,
                  lineHeight: 22,
                  letterSpacing: 0.2,
                  includeFontPadding: false,
                  textAlignVertical: 'center',
                }}
              >
                {t(`menu.${item.key}`)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Pinned footer — same horizontal grid as items */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <View
            style={{
              height: 1,
              backgroundColor: theme.fg + '12',
              marginBottom: 8,
            }}
          />
          <Pressable
            onPress={() => onPickItem(SUPPORT_ITEM)}
            style={({ pressed }) => ({
              paddingVertical: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 16,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={SUPPORT_ITEM.icon} size={22} color={palette.coral} />
            </View>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily: 'Unbounded_700Bold',
                color: palette.coral,
                fontSize: 19,
                lineHeight: 22,
                letterSpacing: 0.2,
                includeFontPadding: false,
                textAlignVertical: 'center',
              }}
            >
              Destek
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}
