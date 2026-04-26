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
          backgroundColor: palette.butter,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: palette.ink + '14',
          marginBottom: 10,
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 22,
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
          backgroundColor: palette.ink,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.paper,
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
          {t('onb.intro_social.sub')}
        </Text>
      </RiseIn>

      <View style={{ flex: 1, marginTop: 28, marginBottom: 24, justifyContent: 'center' }}>
        {ROWS.map((r, i) => (
          <LeaderRow key={r.rank} index={i} {...r} />
        ))}
      </View>

      <RiseIn delay={280}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.intro_social.cta')}
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
              {t('onb.intro_social.cta')}
            </Text>
          </View>
        </Pressable>
      </RiseIn>
    </View>
  );
}
