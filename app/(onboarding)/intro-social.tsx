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
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';

type RowProps = {
  index: number;
  rank: number;
  name: string;
  handle: string;
  minutes: number;
  isYou?: boolean;
};

function LeaderRow({ index, rank, name, handle, minutes, isYou }: RowProps) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      index * 120,
      withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) })
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 20 }],
  }));

  const initial = name.charAt(0).toUpperCase();

  return (
    <Animated.View
      style={style}
      className="bg-butter rounded-2xl px-4 py-3 flex-row items-center gap-3 border border-ink/5"
    >
      <Text className="font-display text-ink text-2xl w-8 text-center">{rank}</Text>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: palette.mauve,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text className="font-semibold text-paper text-base">{initial}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-medium text-ink text-base">{name}</Text>
        <Text className="font-sans text-ink/50 text-xs">{handle}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        {isYou ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.coral }}
          />
        ) : null}
        <Text className="font-mono text-ink text-base">{minutes}dk</Text>
      </View>
    </Animated.View>
  );
}

const ROWS: Array<Omit<RowProps, 'index'>> = [
  { rank: 1, name: 'Mert',   handle: '@mert', minutes: 247, isYou: true },
  { rank: 2, name: 'Zeynep', handle: '@zey',  minutes: 231 },
  { rank: 3, name: 'Burak',  handle: '@brk',  minutes: 198 },
];

export default function IntroSocial() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.intro_social.title').split('\n');

  const onBack = async () => {
    await hx.tap();
    router.back();
  };
  const onContinue = async () => {
    await hx.press();
    router.push('/(onboarding)/permissions');
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
        <OnboardingProgress total={3} active={2} />
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
        {t('onb.intro_social.sub')}
      </Text>

      <View className="flex-1 mt-8 mb-8 justify-center gap-3">
        {ROWS.map((r, i) => (
          <LeaderRow key={r.rank} index={i} {...r} />
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onb.intro_social.cta')}
        onPress={onContinue}
        className="bg-coral rounded-2xl py-5 active:opacity-90"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
      >
        <Text className="text-paper font-semibold text-lg text-center">
          {t('onb.intro_social.cta')}
        </Text>
      </Pressable>
    </View>
  );
}
