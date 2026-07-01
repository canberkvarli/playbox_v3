import { Component, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
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
// Optional gradient — falls back to solid coral (palette.danger). We check the
// NATIVE module is actually in the running binary (not just the JS package),
// because an OTA can deliver this JS to an older build that predates the native
// view — rendering <LinearGradient> there shows a raw "Unimplemented component"
// box (it doesn't throw, so an error boundary alone wouldn't catch it).
let LinearGradient: any = null;
try {
  const { requireOptionalNativeModule } = require('expo');
  if (requireOptionalNativeModule?.('ExpoLinearGradient')) {
    LinearGradient = require('expo-linear-gradient').LinearGradient;
  }
} catch {}

import { useT } from '@/hooks/useT';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { Surface } from '@/components/ui';
import { type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';

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

// --- Sub-components ---------------------------------------------------------

function StatCard({
  label,
  value,
  valueSize = 30,
}: {
  label: string;
  value: string;
  valueSize?: number;
}) {
  return (
    <Surface radius={20} padding={16} style={{ flex: 1 }}>
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.voltText,
          fontSize: valueSize,
          lineHeight: valueSize + 4,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          color: palette.muted,
          fontSize: 13,
          marginTop: 6,
        }}
      >
        {label}
      </Text>
    </Surface>
  );
}

// Renders the coral→orange gradient streak hero, but falls back to a SOLID
// coral if expo-linear-gradient's native view isn't in the running binary (i.e.
// an OTA delivered this JS to an older build that predates the module). Without
// this guard, rendering <LinearGradient> on such a build would crash the screen.
class StreakHeroBg extends Component<
  { style: object; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    const { style, children } = this.props;
    if (this.state.failed || !LinearGradient) {
      return <View style={[style, { backgroundColor: palette.danger }]}>{children}</View>;
    }
    return (
      <LinearGradient
        colors={['#FF7A2F', '#FF5C39']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={style}
      >
        {children}
      </LinearGradient>
    );
  }
}

// --- Screen -----------------------------------------------------------------

export default function Profile() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { username, initial } = useDisplayUser();
  const [capturing, setCapturing] = useState(false);
  const flexCardRef = useRef<any>(null);

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 24,
        }}
      >
        {/* Top row: PROFİL kicker + settings gear. No sticky bar — the avatar
            gets room to breathe instead of butting against a header. */}
        <RiseIn delay={0}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: palette.muted,
                fontSize: 12,
                letterSpacing: 2.5,
                textTransform: 'uppercase',
              }}
            >
              {t('profile.title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="ayarlar"
              onPress={onSettings}
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
                <Feather name="settings" size={20} color={palette.ink} />
              </View>
            </Pressable>
          </View>
        </RiseIn>

        {/* Hero identity — tap routes to settings where the name + username
            overrides live (and persist via zustand-persist + AsyncStorage). */}
        <RiseIn delay={40}>
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
              marginTop: 20,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: palette.volt,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 20,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.voltInk,
                  fontSize: 24,
                  lineHeight: 28,
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
                    color: palette.fg,
                    fontSize: 22,
                    lineHeight: 26,
                    marginRight: 8,
                  }}
                >
                  @{username}
                </Text>
                <Feather name="edit-2" size={15} color={palette.voltText} />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Inter_500Medium',
                  color: palette.muted,
                  fontSize: 13,
                  marginTop: 4,
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

        {/* Streak hero — full-width coral→orange gradient. The gradient stops
            are the only hardcoded hex (per design comp); everything else keys
            off the palette. Falls back to a solid coral when the gradient
            package isn't installed. */}
        <RiseIn delay={80}>
          <StreakHeroBg style={{ borderRadius: 24, padding: 28, marginTop: 16 }}>
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.voltInk,
                fontSize: 110,
                lineHeight: 116,
              }}
            >
              {ME.streakDays}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                color: palette.voltInk,
                fontSize: 18,
                marginTop: 4,
              }}
            >
              {t('profile.streak.days_suffix')} 🔥
            </Text>
          </StreakHeroBg>
        </RiseIn>

        {/* Stat grid — 2×2 dark cards, volt values over muted labels. */}
        <RiseIn delay={160}>
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <StatCard
                  value={String(ME.totalMinutes)}
                  label={t('profile.stats.total_minutes_label')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  value="#12"
                  label={t('profile.stats.city_rank_label')}
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <StatCard
                  value={String(ME.sessionsThisWeek)}
                  label={`${t('profile.stats.this_week_label')} · ${t('profile.stats.sessions_unit')}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  value={SPORT_EMOJI[ME.favoriteSport]}
                  valueSize={34}
                  label={t('profile.stats.fav_label')}
                />
              </View>
            </View>
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
                backgroundColor: palette.surface,
                borderRadius: 24,
                padding: 22,
                marginTop: 24,
              }}
            >
              {!capturing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="paylaş"
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
                      backgroundColor: palette.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="share-2" size={18} color={palette.fg} />
                  </View>
                </Pressable>
              ) : null}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'JetBrainsMono_500Medium',
                  color: palette.voltText,
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
                  color: palette.voltText,
                  fontSize: 56,
                  lineHeight: 66,
                  marginTop: 6,
                }}
              >
                {ME.sessionsThisWeek}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_700Bold',
                  color: palette.fg,
                  fontSize: 16,
                  marginTop: 2,
                }}
              >
                {t('profile.flex.played_suffix')}
              </Text>
              <View
                style={{
                  height: 1,
                  backgroundColor: palette.border,
                  marginVertical: 16,
                }}
              />
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_500Medium',
                  color: palette.muted,
                  fontSize: 13,
                  lineHeight: 18,
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
                    color: palette.voltText,
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
