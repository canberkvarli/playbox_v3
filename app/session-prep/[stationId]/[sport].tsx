import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { RiseIn } from '@/components/RiseIn';

type StepKey = 'pick' | 'scan' | 'play' | 'return';

type StepConfig = {
  key: StepKey;
  icon: keyof typeof Feather.glyphMap;
  bg: string;
};

const STEPS: StepConfig[] = [
  { key: 'pick', icon: 'grid', bg: palette.mauve + '33' },
  { key: 'scan', icon: 'camera', bg: palette.coral + '33' },
  { key: 'play', icon: 'play-circle', bg: palette.butter },
  { key: 'return', icon: 'rotate-ccw', bg: palette.ink + '26' },
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

  const onClose = async () => {
    if (unlocking) return;
    await hx.tap();
    router.back();
  };

  const onOyna = async () => {
    if (unlocking) return;
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
    <View className="flex-1 bg-paper dark:bg-ink">
      {/* Close button — top-left */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.fg + '0d',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="x" size={20} color={theme.fg} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 72,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 24,
        }}
      >
        {/* Gate badge + station name + subtitle */}
        <RiseIn delay={0}>
          <View className="items-center">
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
                K{n} · {sportLabel}
              </Text>
            </View>
            <Text
              className="font-display-x text-ink dark:text-paper text-3xl text-center mt-4"
              style={{ lineHeight: 36 }}
            >
              {station.name}
            </Text>
            <Text className="font-sans text-ink/60 dark:text-paper/60 text-base text-center mt-2">
              {t('prep.gate_ready', { sport: sportLabel })}
            </Text>
          </View>
        </RiseIn>

        {/* Reminder title */}
        <RiseIn delay={80}>
          <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mt-10 mb-3">
            {t('prep.how_it_works')}
          </Text>
        </RiseIn>

        {/* Step cards */}
        <View style={{ gap: 12 }}>
          {STEPS.map((step, i) => (
            <RiseIn key={step.key} delay={120 + i * 60}>
              <View
                className="bg-paper dark:bg-ink/40 rounded-3xl p-5 border border-ink/10 dark:border-paper/10"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: step.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    className="font-display-x text-2xl"
                    style={{ color: palette.ink }}
                  >
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text className="font-display text-ink dark:text-paper text-lg">
                    {t(`tour.steps.${step.key}.title`)}
                  </Text>
                  <Text className="font-sans text-ink/70 dark:text-paper/70 text-sm mt-1">
                    {t(`tour.steps.${step.key}.desc`)}
                  </Text>
                </View>
                <Feather name={step.icon} size={22} color={theme.fg + '99'} />
              </View>
            </RiseIn>
          ))}
        </View>
      </ScrollView>

      {/* Pinned OYNA CTA */}
      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + 16,
        }}
      >
        <Pressable
          onPress={onOyna}
          disabled={unlocking}
          accessibilityRole="button"
          accessibilityLabel={t('prep.cta')}
          style={({ pressed }) => ({
            backgroundColor: unlocking ? palette.butter : palette.coral,
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
            name={unlocking ? 'unlock' : 'play'}
            size={20}
            color={unlocking ? palette.ink : palette.paper}
          />
          <Text
            className="font-semibold text-lg"
            style={{ color: unlocking ? palette.ink : palette.paper }}
          >
            {unlocking ? t('prep.opening') : t('prep.cta')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
