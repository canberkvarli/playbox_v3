import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
let ViewShot: any = View;
let captureRef: any = async () => '';
try {
  const mod = require('react-native-view-shot');
  ViewShot = mod.default;
  captureRef = mod.captureRef;
} catch {}
let Sharing: any = { isAvailableAsync: async () => false, shareAsync: async () => {} };
try { Sharing = require('expo-sharing'); } catch {}
let FileSystem: any = null;
try { FileSystem = require('expo-file-system'); } catch {}

import { useT } from '@/hooks/useT';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { SPORT_LABELS, type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// --- Fake data (v1) ---------------------------------------------------------

const ME = {
  city: 'İstanbul',
  joinedMonth: 'Mart 2026',
  streakDays: 7,
  streakBest: 21,
  totalMinutes: 247,
  sessionsThisWeek: 4,
  favoriteSport: 'football' as Sport,
};

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
          stroke={palette.ink + '22'}
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
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 13,
            letterSpacing: 0.4,
          }}
        >
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
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        borderWidth: 1.5,
        borderColor: palette.ink + '22',
        borderRadius: 18,
        padding: 16,
      }}
    >
      <Text
        style={{
          fontFamily: 'Unbounded_700Bold',
          color: palette.ink,
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 32,
            lineHeight: 36,
          }}
        >
          {value}
        </Text>
        {unit ? (
          <Text
            style={{
              fontFamily: 'Inter_700Bold',
              color: palette.ink,
              fontSize: 14,
              marginLeft: 6,
            }}
          >
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// --- Screen -----------------------------------------------------------------

export default function Profile() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { displayName, username, initial } = useDisplayUser();
  const [capturing, setCapturing] = useState(false);
  const flexCardRef = useRef<ViewShot>(null);

  const milestone = nextMilestone(ME.streakDays);

  const onSettings = async () => {
    await hx.tap();
    router.push('/settings');
  };

  const onShareFlex = async () => {
    await hx.press();
    setCapturing(true);
    try {
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 50));
      const tmpUri = await captureRef(flexCardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      let shareUri = tmpUri;
      if (FileSystem?.cacheDirectory && FileSystem?.copyAsync) {
        const today = new Date().toISOString().slice(0, 10);
        const named = `${FileSystem.cacheDirectory}playbox-haftalik-${today}.png`;
        try {
          await FileSystem.deleteAsync(named, { idempotent: true });
          await FileSystem.copyAsync({ from: tmpUri, to: named });
          shareUri = named;
        } catch (e) {
          if (__DEV__) console.warn('[playbox] rename capture failed', e);
        }
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        console.warn('[playbox] Sharing not available on this platform');
        return;
      }
      await Sharing.shareAsync(shareUri, {
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

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Sticky header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.ink + '14',
          backgroundColor: palette.paper,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={async () => {
            await hx.tap();
            router.replace('/(tabs)/map');
          }}
          hitSlop={14}
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
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          {t('profile.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="settings"
          onPress={onSettings}
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
            <Feather name="settings" size={20} color={palette.ink} />
          </View>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 24,
        }}
      >
        {/* Hero identity — tap routes to settings where the name + username
            overrides live (and persist via zustand-persist + AsyncStorage). */}
        <RiseIn delay={0}>
          <Pressable
            onPress={async () => {
              await hx.tap();
              router.push('/settings');
            }}
            accessibilityRole="button"
            accessibilityLabel="adı düzenle"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 24,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                backgroundColor: palette.ink,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 16,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 36,
                }}
              >
                {initial}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.ink,
                    fontSize: 28,
                    lineHeight: 32,
                    marginRight: 8,
                  }}
                >
                  {displayName}
                </Text>
                <Feather name="edit-2" size={16} color={palette.ink} />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Inter_700Bold',
                  color: palette.ink,
                  fontSize: 14,
                  marginTop: 4,
                }}
              >
                @{username}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.ink,
                  fontSize: 12,
                  marginTop: 6,
                  opacity: 0.7,
                }}
              >
                {t('profile.joined_since', {
                  city: ME.city,
                  month: ME.joinedMonth,
                })}
              </Text>
            </View>
          </Pressable>
        </RiseIn>

        {/* Streak card */}
        <RiseIn delay={80}>
          <View
            style={{
              backgroundColor: palette.butter,
              borderRadius: 24,
              padding: 22,
              marginTop: 28,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {t('profile.streak.label')}
              </Text>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.ink,
                  fontSize: 64,
                  lineHeight: 68,
                }}
              >
                {ME.streakDays}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  color: palette.ink,
                  fontSize: 14,
                  marginTop: 2,
                }}
              >
                {t('profile.streak.days_suffix')}
              </Text>
            </View>
            <StreakRing streak={ME.streakDays} milestone={milestone} />
          </View>
        </RiseIn>

        {/* Stats grid (2x1 + 1) */}
        <RiseIn delay={160}>
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <StatCard
                  label={t('profile.stats.total_minutes_label')}
                  value={String(ME.totalMinutes)}
                  unit="dk"
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  label={t('profile.stats.this_week_label')}
                  value={String(ME.sessionsThisWeek)}
                  unit={t('profile.stats.sessions_unit')}
                />
              </View>
            </View>
            <StatCard
              label={t('profile.stats.fav_label')}
              value={`${SPORT_EMOJI[ME.favoriteSport]} ${SPORT_LABELS[ME.favoriteSport]}`}
            />
          </View>
        </RiseIn>

        {/* Flex card — keeps the dark surface intentionally; it's a shareable
            asset, not part of the page chrome. Inner copy is white-on-ink so
            it reads cleanly when exported as a PNG. */}
        <RiseIn delay={240}>
          <ViewShot
            ref={flexCardRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile' }}
          >
            <View
              style={{
                backgroundColor: palette.ink,
                borderRadius: 24,
                padding: 22,
                marginTop: 24,
              }}
            >
              {!capturing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="share"
                  onPress={onShareFlex}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: palette.paper + '1f',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="share-2" size={18} color={palette.paper} />
                  </View>
                </Pressable>
              ) : null}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.butter,
                  fontSize: 11,
                  letterSpacing: 1.4,
                  textTransform: 'uppercase',
                  paddingRight: 56, // reserved for the absolute share button
                }}
              >
                {t('profile.flex.header', { city: ME.city })}
              </Text>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.butter,
                  fontSize: 56,
                  lineHeight: 60,
                  marginTop: 6,
                }}
              >
                {ME.sessionsThisWeek}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  color: palette.paper,
                  fontSize: 16,
                  marginTop: 2,
                }}
              >
                {t('profile.flex.played_suffix')}
              </Text>
              <View
                style={{
                  height: 1,
                  backgroundColor: palette.paper + '22',
                  marginVertical: 16,
                }}
              />
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_500Medium',
                  color: palette.paper,
                  fontSize: 13,
                  lineHeight: 18,
                  opacity: 0.85,
                }}
              >
                {t('profile.flex.summary', {
                  minutes: ME.totalMinutes,
                  streak: ME.streakDays,
                })}
              </Text>
              <View style={{ marginTop: 12, alignItems: 'center' }}>
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.butter,
                    fontSize: 11,
                    letterSpacing: 4,
                  }}
                >
                  PLAYBOX
                </Text>
              </View>
            </View>
          </ViewShot>
        </RiseIn>
      </ScrollView>
    </View>
  );
}
