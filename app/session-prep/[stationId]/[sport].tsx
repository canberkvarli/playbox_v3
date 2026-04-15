import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import {
  STATIONS,
  SPORT_LABELS,
  type Station,
  type Sport,
} from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useSessionStore } from '@/stores/sessionStore';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';

type StepKey = 'pick' | 'scan' | 'play' | 'return';

type StepConfig = {
  key: StepKey;
  icon: keyof typeof Feather.glyphMap;
  bg: string;
};

const STEPS: StepConfig[] = [
  { key: 'pick', icon: 'grid', bg: palette.mauve },
  { key: 'scan', icon: 'camera', bg: palette.coral },
  { key: 'play', icon: 'play-circle', bg: palette.butter },
  { key: 'return', icon: 'rotate-ccw', bg: palette.ink },
];

export default function SessionPrep() {
  const { t } = useT();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { stationId, sport } = useLocalSearchParams<{
    stationId: string;
    sport: Sport;
  }>();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);
  const startSession = useSessionStore((s) => s.startSession);

  const station: Station | null = useMemo(() => {
    if (lastSelected && lastSelected.id === stationId) return lastSelected;
    return STATIONS.find((s) => s.id === stationId) ?? null;
  }, [stationId, lastSelected]);

  const [step, setStep] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  if (!station) {
    return (
      <View
        className="flex-1 bg-paper dark:bg-ink items-center justify-center px-6"
        style={{ paddingTop: insets.top }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 16, left: 16 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Feather name="x" size={24} color={theme.fg} />
        </Pressable>
        <Text className="font-display-x text-ink dark:text-paper text-3xl text-center">
          {t('station.not_found')}
        </Text>
        <Text className="font-sans text-ink/60 dark:text-paper/60 text-center mt-3">
          {t('station.not_found_sub')}
        </Text>
      </View>
    );
  }

  const gateIndex = station.sports.indexOf(sport);
  const n = gateIndex >= 0 ? gateIndex + 1 : 1;
  const sportLabel = SPORT_LABELS[sport] ?? sport;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const onBack = async () => {
    if (unlocking) return;
    await hx.tap();
    if (step === 0) {
      router.back();
    } else {
      setStep(step - 1);
    }
  };

  const onContinue = async () => {
    if (unlocking) return;
    if (isLast) return onOyna();
    await hx.tap();
    setStep(step + 1);
  };

  const onOyna = async () => {
    setUnlocking(true);
    await hx.tap();
    await new Promise((r) => setTimeout(r, 150));
    await hx.tap();
    await new Promise((r) => setTimeout(r, 150));
    await hx.punch();
    await new Promise((r) => setTimeout(r, 250));
    await hx.yes();
    startSession({
      stationId: station.id,
      stationName: station.name,
      sport,
      durationMinutes: 30,
    });
    router.replace('/(tabs)/play');
  };

  return (
    <View
      className="flex-1 bg-paper dark:bg-ink px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      {/* Top row: back + progress */}
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather
            name={step === 0 ? 'x' : 'arrow-left'}
            size={24}
            color={theme.fg}
          />
        </Pressable>
        <OnboardingProgress total={STEPS.length} active={step} />
      </View>

      {/* Station context pill */}
      <View className="items-start mt-6">
        <View
          style={{
            backgroundColor: palette.ink,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
          }}
        >
          <Text
            className="font-mono text-paper"
            style={{ fontSize: 12, letterSpacing: 0.5 }}
          >
            K{n} · {sportLabel} · {station.name}
          </Text>
        </View>
      </View>

      {/* Step content — key={step} re-triggers RiseIn on each advance */}
      <View key={step} style={{ flex: 1 }}>
        <RiseIn delay={0}>
          <Text className="font-mono text-ink/45 dark:text-paper/45 text-xs tracking-widest mt-8">
            {step + 1} / {STEPS.length}
          </Text>
          <Text
            className="font-display-x text-ink dark:text-paper text-5xl mt-2"
            style={{ lineHeight: 52 }}
          >
            {t(`tour.steps.${current.key}.title`)}
          </Text>
        </RiseIn>

        <RiseIn delay={80}>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base leading-6 mt-4">
            {t(`tour.steps.${current.key}.desc`)}
          </Text>
        </RiseIn>

        <RiseIn
          delay={160}
          style={{ flex: 1, marginTop: 32, marginBottom: 16 }}
        >
          <View
            className="flex-1 rounded-3xl items-center justify-center border border-ink/10 dark:border-paper/10"
            style={{ backgroundColor: current.bg + (current.bg === palette.ink ? '' : '40') }}
          >
            <View
              style={{
                width: 140,
                height: 140,
                borderRadius: 70,
                backgroundColor: current.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather
                name={current.icon}
                size={60}
                color={current.bg === palette.ink ? palette.paper : palette.ink}
              />
            </View>
          </View>
        </RiseIn>
      </View>

      {/* Pinned CTA */}
      <RiseIn delay={240}>
        <Pressable
          onPress={onContinue}
          disabled={unlocking}
          accessibilityRole="button"
          accessibilityLabel={isLast ? t('prep.cta') : t('onb.intro_map.cta')}
          style={({ pressed }) => ({
            backgroundColor: unlocking
              ? palette.butter
              : isLast
              ? palette.coral
              : palette.ink,
            borderRadius: 20,
            paddingVertical: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            transform: [{ scale: pressed && !unlocking ? 0.98 : 1 }],
          })}
        >
          <Feather
            name={unlocking ? 'unlock' : isLast ? 'play' : 'arrow-right'}
            size={20}
            color={unlocking ? palette.ink : palette.paper}
          />
          <Text
            className="font-semibold text-lg"
            style={{ color: unlocking ? palette.ink : palette.paper }}
          >
            {unlocking
              ? t('prep.opening')
              : isLast
              ? t('prep.cta')
              : t('onb.intro_map.cta')}
          </Text>
        </Pressable>
      </RiseIn>
    </View>
  );
}
