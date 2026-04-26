import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';

type MarkerProps = { left: `${number}%`; top: `${number}%`; delay: number };

function PulseMarker({ left, top, delay }: MarkerProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }),
        -1,
        false
      )
    );
  }, [delay, progress]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 1.5 }],
    opacity: 0.6 * (1 - progress.value),
  }));

  return (
    <View style={{ position: 'absolute', left, top }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: -22,
            top: -22,
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: palette.coral,
          },
          ring,
        ]}
      />
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: palette.coral,
        }}
      />
    </View>
  );
}

export default function IntroMap() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.intro_map.title').split('\n');

  const onBack = async () => {
    await hx.tap();
    router.back();
  };
  const onContinue = async () => {
    await hx.press();
    router.push('/(onboarding)/intro-social');
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.ink + '0d',
              borderWidth: 1,
              borderColor: palette.ink + '14',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.ink} />
          </View>
        </Pressable>
        <OnboardingProgress total={3} active={1} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 40 }}>
          {titleLines.map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 44,
                lineHeight: 48,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
      </RiseIn>

      <RiseIn delay={80}>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 16,
            lineHeight: 24,
            marginTop: 16,
            opacity: 0.85,
          }}
        >
          {t('onb.intro_map.sub')}
        </Text>
      </RiseIn>

      <RiseIn delay={160} style={{ flex: 1, marginTop: 32, marginBottom: 32 }}>
        <View
          style={{
            flex: 1,
            borderRadius: 18,
            backgroundColor: palette.butter,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: palette.ink + '14',
          }}
        >
          {[0.25, 0.5, 0.75].map((p) => (
            <View
              key={`h-${p}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${p * 100}%`,
                height: 1,
                backgroundColor: palette.ink + '0d',
              }}
            />
          ))}
          {[0.25, 0.5, 0.75].map((p) => (
            <View
              key={`v-${p}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${p * 100}%`,
                width: 1,
                backgroundColor: palette.ink + '0d',
              }}
            />
          ))}
          <PulseMarker left="20%" top="30%" delay={0} />
          <PulseMarker left="60%" top="50%" delay={600} />
          <PulseMarker left="35%" top="75%" delay={1200} />
        </View>
      </RiseIn>

      <RiseIn delay={240}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.intro_map.cta')}
          onPress={onContinue}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 20,
              paddingVertical: 20,
              alignItems: 'center',
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
              {t('onb.intro_map.cta')}
            </Text>
          </View>
        </Pressable>
      </RiseIn>
    </View>
  );
}
