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
      className="flex-1 bg-paper px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={palette.ink} />
        </Pressable>
        <OnboardingProgress total={3} active={1} />
      </View>

      <View className="mt-12">
        {titleLines.map((line, i) => (
          <Text
            key={i}
            className="font-display-x text-ink text-5xl"
            style={{ lineHeight: 48 }}
          >
            {line}
          </Text>
        ))}
      </View>

      <Text className="font-sans text-ink/70 text-base leading-6 mt-4">
        {t('onb.intro_map.sub')}
      </Text>

      <View className="flex-1 mt-8 mb-8">
        <View className="flex-1 rounded-2xl bg-butter overflow-hidden border border-ink/10">
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
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onb.intro_map.cta')}
        onPress={onContinue}
        className="bg-coral rounded-2xl py-5 active:opacity-90"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
      >
        <Text className="text-paper font-semibold text-lg text-center">
          {t('onb.intro_map.cta')}
        </Text>
      </Pressable>
    </View>
  );
}
