import { useEffect } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { useGuardedPress } from '@/hooks/useGuardedPress';

export default function Welcome() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.welcome.title').split('\n');

  const onStart = useGuardedPress(async () => {
    await hx.press();
    router.push('/(onboarding)/intro-map');
  });

  // Logo entrance: springy zoom-in + tilt settle, then a slow idle bob.
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);
  const logoRotate = useSharedValue(-8);
  const logoBob = useSharedValue(0);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSpring(1, { damping: 10, stiffness: 140, mass: 0.9 });
    logoRotate.value = withSequence(
      withTiming(4, { duration: 280, easing: Easing.out(Easing.cubic) }),
      withSpring(0, { damping: 8, stiffness: 160 }),
    );
    logoBob.value = withDelay(
      900,
      withRepeat(
        withSequence(
          withTiming(-6, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [logoBob, logoOpacity, logoRotate, logoScale]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [
      { translateY: logoBob.value },
      { scale: logoScale.value },
      { rotate: `${logoRotate.value}deg` },
    ],
  }));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingHorizontal: 24,
        paddingTop: insets.top + 32,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
        <Animated.View
          style={[
            {
              width: 132,
              height: 132,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: '#211F29',
              shadowColor: palette.ink,
              shadowOffset: { width: 0, height: 14 },
              shadowOpacity: 0.22,
              shadowRadius: 22,
              elevation: 14,
            },
            logoStyle,
          ]}
        >
          <Image
            source={require('@/assets/images/playbox.jpg')}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        </Animated.View>
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 12 }}>
          {titleLines.map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 56,
                lineHeight: 60,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 17,
            lineHeight: 24,
            marginTop: 22,
            opacity: 0.85,
          }}
        >
          {t('onb.welcome.sub')}
        </Text>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.welcome.cta')}
          onPress={onStart}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 20,
              paddingVertical: 20,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.32,
              shadowRadius: 18,
              elevation: 12,
            }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 18,
                letterSpacing: 0.5,
              }}
            >
              {t('onb.welcome.cta')}
            </Text>
          </View>
        </Pressable>
      </RiseIn>
    </View>
  );
}
