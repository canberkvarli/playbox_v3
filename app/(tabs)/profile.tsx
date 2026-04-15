import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { SPORT_LABELS, type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// --- Fake data (v1) ---------------------------------------------------------

const ME = {
  name: 'Mert',
  handle: '@mert',
  city: 'İstanbul',
  joinedMonth: 'Mart 2026',
  streakDays: 7,
  streakBest: 21,
  totalMinutes: 247,
  sessionsThisWeek: 4,
  favoriteSport: 'football' as Sport,
  cityRank: 1,
};

const FRIENDS = [
  { name: 'Zeynep', handle: '@zey', following: true, minutes: 231 },
  { name: 'Burak', handle: '@brk', following: false, minutes: 198 },
  { name: 'Ayşe', handle: '@ays', following: true, minutes: 180 },
];

function nextMilestone(streak: number) {
  if (streak < 7) return 7;
  if (streak < 14) return 14;
  if (streak < 30) return 30;
  if (streak < 60) return 60;
  if (streak < 100) return 100;
  return streak + 50;
}

// --- Streak ring ------------------------------------------------------------

function StreakRing({ streak, milestone }: { streak: number; milestone: number }) {
  const size = 100;
  const strokeWidth = 10;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(streak / milestone, 1);
  const offset = useSharedValue(circumference);

  useEffect(() => {
    offset.value = withTiming(circumference * (1 - progress), {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [circumference, offset, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={palette.ink + '14'}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={r}
          stroke={palette.coral}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text className="font-mono text-ink/50 text-xs">
          {streak}/{milestone}
        </Text>
      </View>
    </View>
  );
}

// --- Sub-components ---------------------------------------------------------

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View className="bg-paper border border-ink/10 rounded-2xl p-4 flex-1">
      <Text className="font-medium text-ink/50 uppercase tracking-wider text-xs mb-2">
        {label}
      </Text>
      <View className="flex-row items-baseline">
        <Text className="font-display-x text-ink text-3xl">{value}</Text>
        {unit ? (
          <Text className="font-sans text-ink/50 text-sm ml-1">{unit}</Text>
        ) : null}
      </View>
    </View>
  );
}

function FriendRow({
  name,
  handle,
  following,
  onToggle,
}: {
  name: string;
  handle: string;
  following: boolean;
  onToggle: () => void;
}) {
  const { t } = useT();
  const initial = name.charAt(0).toUpperCase();

  return (
    <View className="bg-paper border border-ink/10 rounded-2xl px-4 py-3 flex-row items-center gap-3">
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
      <Pressable
        accessibilityRole="button"
        onPress={onToggle}
        hitSlop={8}
        className={
          following
            ? 'border border-ink/20 rounded-full px-3 py-1.5'
            : 'bg-coral rounded-full px-3 py-1.5'
        }
      >
        <Text
          className={
            following
              ? 'font-medium text-ink text-xs'
              : 'font-medium text-paper text-xs'
          }
        >
          {following ? t('profile.friends.following') : t('profile.friends.follow')}
        </Text>
      </Pressable>
    </View>
  );
}

// --- Screen -----------------------------------------------------------------

export default function Profile() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [follows, setFollows] = useState(() => FRIENDS.map((f) => f.following));
  const [capturing, setCapturing] = useState(false);
  const flexCardRef = useRef<ViewShot>(null);

  const milestone = nextMilestone(ME.streakDays);

  const onSettings = async () => {
    await hx.tap();
    console.log('settings');
  };

  const onShareFlex = async () => {
    await hx.press();
    setCapturing(true);
    try {
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 50));
      const uri = await captureRef(flexCardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        console.warn('[playbox] Sharing not available on this platform');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Playbox',
        UTI: 'public.png',
      });
    } catch (e) {
      console.warn('[playbox] share failed', e);
      await hx.no();
    } finally {
      setCapturing(false);
    }
  };

  const onToggleFollow = async (idx: number) => {
    await hx.tap();
    setFollows((prev) => prev.map((v, i) => (i === idx ? !v : v)));
  };

  return (
    <View className="flex-1 bg-paper">
      {/* Sticky header */}
      <View
        style={{ paddingTop: insets.top + 8 }}
        className="px-6 pb-3 border-b border-ink/10 bg-paper"
      >
        <View className="flex-row items-center justify-between">
          <Text className="font-display text-ink text-lg">{t('profile.title')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="settings"
            onPress={onSettings}
            hitSlop={12}
          >
            <Feather name="settings" size={22} color={palette.ink} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 24,
        }}
      >
        {/* Hero identity */}
        <RiseIn delay={0}>
          <View className="flex-row items-center mt-6">
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                backgroundColor: palette.mauve,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text className="font-display-x text-paper text-4xl">
                {ME.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View className="flex-1 pl-4">
              <Text className="font-display-x text-ink text-3xl">{ME.name}</Text>
              <Text className="font-mono text-ink/60 text-base">{ME.handle}</Text>
              <Text className="font-sans text-ink/50 text-xs mt-1">
                {t('profile.joined_since', {
                  city: ME.city,
                  month: ME.joinedMonth,
                })}
              </Text>
            </View>
          </View>
        </RiseIn>

        {/* Streak card */}
        <RiseIn delay={80}>
          <View className="bg-butter rounded-3xl p-6 mt-6 flex-row items-center">
            <View className="flex-1">
              <Text className="font-medium text-ink/60 uppercase tracking-wider text-xs mb-2">
                {t('profile.streak.label')}
              </Text>
              <Text className="font-display-x text-ink text-7xl">
                {ME.streakDays}
              </Text>
              <Text className="font-sans text-ink/60 text-sm">
                {t('profile.streak.days_suffix')}
              </Text>
            </View>
            <StreakRing streak={ME.streakDays} milestone={milestone} />
          </View>
        </RiseIn>

        {/* Stats grid (2x2) */}
        <RiseIn delay={160}>
          <View className="mt-6 gap-3">
            <View className="flex-row gap-3">
              <StatCard
                label={t('profile.stats.total_minutes_label')}
                value={String(ME.totalMinutes)}
                unit="dk"
              />
              <StatCard
                label={t('profile.stats.this_week_label')}
                value={String(ME.sessionsThisWeek)}
                unit={t('profile.stats.sessions_unit')}
              />
            </View>
            <View className="flex-row gap-3">
              <StatCard
                label={t('profile.stats.fav_label')}
                value={`${SPORT_EMOJI[ME.favoriteSport]} ${SPORT_LABELS[ME.favoriteSport]}`}
              />
              <StatCard
                label={t('profile.stats.city_rank_label')}
                value={`#${ME.cityRank}`}
              />
            </View>
          </View>
        </RiseIn>

        {/* Flex card */}
        <RiseIn delay={240}>
          <ViewShot
            ref={flexCardRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile' }}
          >
            <View className="bg-ink rounded-3xl p-6 mt-6">
              {!capturing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="share"
                  onPress={onShareFlex}
                  hitSlop={8}
                  style={{ position: 'absolute', top: 16, right: 16 }}
                  className="bg-paper/10 rounded-full p-2"
                >
                  <Feather name="share-2" size={20} color={palette.butter} />
                </Pressable>
              ) : null}
              <Text className="font-mono text-paper/60 text-xs uppercase tracking-wider">
                {t('profile.flex.header', { city: ME.city })}
              </Text>
              <Text className="font-display-x text-butter text-6xl mt-2">
                {ME.sessionsThisWeek}
              </Text>
              <Text className="font-sans text-paper/80 text-base">
                {t('profile.flex.played_suffix')}
              </Text>
              <View className="h-px bg-paper/15 my-4" />
              <Text className="font-mono text-paper/70 text-sm">
                {t('profile.flex.summary', {
                  rank: ME.cityRank,
                  minutes: ME.totalMinutes,
                  streak: ME.streakDays,
                })}
              </Text>
              <View className="mt-3 items-center">
                <Text className="font-display text-butter/80 text-xs tracking-[4px]">
                  PLAYBOX
                </Text>
              </View>
            </View>
          </ViewShot>
        </RiseIn>

        {/* Friends section */}
        <RiseIn delay={320}>
          <View className="mt-6">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="font-medium text-ink/60 uppercase tracking-wider text-xs">
                {t('profile.friends.label')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="add friend"
                onPress={async () => {
                  await hx.tap();
                  console.log('add friend');
                }}
                hitSlop={8}
                className="bg-paper border border-ink/10 rounded-full p-2"
              >
                <Feather name="user-plus" size={18} color={palette.ink} />
              </Pressable>
            </View>
            <View className="gap-3">
              {FRIENDS.map((f, i) => (
                <FriendRow
                  key={f.handle}
                  name={f.name}
                  handle={f.handle}
                  following={follows[i]}
                  onToggle={() => onToggleFollow(i)}
                />
              ))}
            </View>
          </View>
        </RiseIn>
      </ScrollView>
    </View>
  );
}
