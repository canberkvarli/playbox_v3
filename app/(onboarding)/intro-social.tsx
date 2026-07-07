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
import { RiseIn } from '@/components/RiseIn';
import { Button } from '@/components/ui';
import { useGuardedPress } from '@/hooks/useGuardedPress';

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
      style={[
        {
          backgroundColor: isYou ? palette.volt + '14' : palette.surface,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: isYou ? palette.volt : palette.border,
          marginBottom: 10,
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: isYou ? palette.volt : palette.fg,
          fontSize: 22,
          lineHeight: 26,
          width: 32,
          textAlign: 'center',
          marginRight: 10,
        }}
      >
        {rank}
      </Text>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: palette.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 16,
          }}
        >
          {initial}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 15,
          }}
        >
          {name}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.ink,
            fontSize: 11,
            opacity: 0.7,
            marginTop: 2,
          }}
        >
          {handle}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {isYou ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: palette.coral,
              marginRight: 8,
            }}
          />
        ) : null}
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 15,
          }}
        >
          {minutes}dk
        </Text>
      </View>
    </Animated.View>
  );
}

// Illustrative preview of the leaderboard feature (onboarding teaser) — example
// players only. No fake "you" row (the old data marked "Mert" as isYou, which
// falsely read as the real user's stats). Real ranking comes from get_play_stats.
const ROWS: Array<Omit<RowProps, 'index'>> = [
  { rank: 1, name: 'Zeynep', handle: '@zeynep', minutes: 231 },
  { rank: 2, name: 'Burak',  handle: '@burak',  minutes: 198 },
  { rank: 3, name: 'Deniz',  handle: '@deniz',  minutes: 176 },
];

export default function IntroSocial() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.intro_social.title').split('\n');

  const onBack = useGuardedPress(async () => {
    await hx.tap();
    router.back();
  });
  const onContinue = useGuardedPress(async () => {
    await hx.press();
    router.push('/(onboarding)/permissions');
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.bg,
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
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.fg} />
          </View>
        </Pressable>
        <OnboardingProgress total={3} active={2} />
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
                lineHeight: 52,
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
          {t('onb.intro_social.sub')}
        </Text>
      </RiseIn>

      <View style={{ flex: 1, marginTop: 28, marginBottom: 24, justifyContent: 'center' }}>
        {ROWS.map((r, i) => (
          <LeaderRow key={r.rank} index={i} {...r} />
        ))}
      </View>

      <RiseIn delay={280}>
        <Button label={t('onb.intro_social.cta')} onPress={onContinue} full />
      </RiseIn>
    </View>
  );
}
