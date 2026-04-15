import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore, type ActiveSession } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';

// --- Fake history -----------------------------------------------------------

const HISTORY: Array<{
  id: string;
  stationName: string;
  sport: Sport;
  minutes: number;
  hoursAgo: number;
}> = [
  { id: 'h1', stationName: 'Kadıköy Moda', sport: 'football',   minutes: 28, hoursAgo: 2 },
  { id: 'h2', stationName: 'Bebek Sahili', sport: 'paddle',     minutes: 45, hoursAgo: 26 },
  { id: 'h3', stationName: 'Maçka Parkı',  sport: 'basketball', minutes: 32, hoursAgo: 74 },
  { id: 'h4', stationName: 'Moda Sahili',  sport: 'volleyball', minutes: 52, hoursAgo: 168 },
];

// --- Relative time helpers --------------------------------------------------

function relativeTimeTr(hoursAgo: number): string {
  if (hoursAgo < 1) return 'az önce';
  if (hoursAgo < 24) return `${hoursAgo} saat önce`;
  if (hoursAgo < 48) return 'dün';
  const days = Math.floor(hoursAgo / 24);
  if (days < 7) return `${days} gün önce`;
  const weeks = Math.floor(days / 7);
  return `${weeks} hafta önce`;
}

function relativeTimeEn(hoursAgo: number): string {
  if (hoursAgo < 1) return 'just now';
  if (hoursAgo < 24) return `${hoursAgo}h ago`;
  if (hoursAgo < 48) return 'yesterday';
  const days = Math.floor(hoursAgo / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// --- Live Timer -------------------------------------------------------------

function LiveTimer({ session }: { session: ActiveSession }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - session.startedAt;
  const total = session.durationMinutes * 60 * 1000;
  const rawProgress = total > 0 ? elapsed / total : 0;
  const clampedProgress = Math.min(Math.max(rawProgress, 0), 1);
  const overtime = elapsed > total;

  return (
    <View className="bg-ink dark:bg-paper rounded-3xl p-6 mt-4">
      <Text className="font-mono text-butter/80 dark:text-ink/60 text-xs uppercase tracking-wider">
        {t('play.live.eyebrow')}
      </Text>

      <Text
        className="font-mono text-paper dark:text-ink text-7xl text-center mt-3"
        style={{ letterSpacing: 2 }}
      >
        {formatMMSS(elapsed)}
      </Text>

      {/* Progress bar */}
      <View className="bg-paper/15 dark:bg-ink/15 h-1 rounded-full mt-4 overflow-hidden">
        <View
          style={{
            width: `${clampedProgress * 100}%`,
            height: '100%',
            backgroundColor: overtime ? palette.butter : palette.coral,
            borderRadius: 999,
          }}
        />
      </View>

      {/* Meta row */}
      <View className="flex-row items-center gap-2 mt-3">
        <Text style={{ fontSize: 18 }}>{SPORT_EMOJI[session.sport]}</Text>
        <Text className="font-medium text-paper dark:text-ink text-base flex-1">
          {session.stationName}
        </Text>
        <Text className="font-mono text-paper/60 dark:text-ink/60 text-sm">
          {session.durationMinutes}
          {t('play.live.planned_suffix')}
        </Text>
      </View>
    </View>
  );
}

// --- History row ------------------------------------------------------------

function HistoryRow({
  stationName,
  sport,
  minutes,
  timeLabel,
}: {
  stationName: string;
  sport: Sport;
  minutes: number;
  timeLabel: string;
}) {
  return (
    <View className="bg-paper dark:bg-ink border border-ink/10 dark:border-paper/10 rounded-2xl px-4 py-3 flex-row items-center gap-3">
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          backgroundColor: palette.butter,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 24 }}>{SPORT_EMOJI[sport]}</Text>
      </View>
      <View className="flex-1">
        <Text className="font-medium text-ink dark:text-paper text-base">{stationName}</Text>
        <Text className="font-sans text-ink/50 dark:text-paper/50 text-xs mt-0.5">{timeLabel}</Text>
      </View>
      <Text className="font-mono text-ink dark:text-paper text-sm">{minutes}dk</Text>
    </View>
  );
}

// --- Tip row ----------------------------------------------------------------

function TipRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  text: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <Feather name={icon} size={20} color={palette.mauve} />
      <Text className="font-sans text-ink/70 dark:text-paper/70 text-sm flex-1">{text}</Text>
    </View>
  );
}

// --- Screen -----------------------------------------------------------------

export default function Play() {
  const { t, lang } = useT();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const sheetRef = useRef<BottomSheet>(null);

  const active = useSessionStore((s) => s.active);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);

  const fakeActiveSession = useDevStore((s) => s.fakeActiveSession);
  const setFakeActiveSession = useDevStore((s) => s.setFakeActiveSession);

  const relTime = lang === 'en' ? relativeTimeEn : relativeTimeTr;

  // Dev fake: when toggle is on AND no real session, backfill a fake one.
  useEffect(() => {
    if (fakeActiveSession && !active) {
      startSession({
        stationId: 'ist-kadikoy',
        stationName: 'Kadıköy Moda',
        sport: 'football',
        durationMinutes: 30,
        startedAt: Date.now() - 7 * 60 * 1000, // 7 minutes ago
      });
    }
  }, [fakeActiveSession, active, startSession]);

  const hasActive = active !== null;

  const onReturnPress = async () => {
    await hx.punch();
    sheetRef.current?.expand();
  };

  const onConfirmReturn = async () => {
    await hx.yes();
    if (fakeActiveSession) {
      setFakeActiveSession(false);
    }
    endSession();
    sheetRef.current?.close();
  };

  const onCancelReturn = async () => {
    await hx.tap();
    sheetRef.current?.close();
  };

  const onOpenMap = async () => {
    await hx.press();
    router.replace('/(tabs)/map');
  };

  const onHeaderHistoryTap = async () => {
    await hx.tap();
  };

  const onDevToggle = async () => {
    await hx.tap();
    setFakeActiveSession(!fakeActiveSession);
  };

  const historyCountLabel = useMemo(
    () => `${HISTORY.length} ${t('play.history.count_suffix')}`,
    [t]
  );

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
      {/* Sticky header */}
      <View
        style={{ paddingTop: insets.top + 8 }}
        className="px-6 pb-3 border-b border-ink/10 dark:border-paper/10 bg-paper dark:bg-ink"
      >
        <View className="flex-row items-center justify-between">
          <Text className="font-display text-ink dark:text-paper text-lg">{t('play.title')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="history"
            onPress={onHeaderHistoryTap}
            hitSlop={12}
          >
            <Feather name="clock" size={22} color={theme.fg} />
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
        {hasActive && active ? (
          <>
            {/* Section A: live hero */}
            <RiseIn delay={0}>
              <LiveTimer session={active} />
            </RiseIn>

            {/* Section B: return CTA */}
            <RiseIn delay={80}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="return"
                onPress={onReturnPress}
                style={({ pressed }) => ({
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                })}
              >
                <View className="bg-coral rounded-3xl p-6 mt-3 flex-row items-center justify-between">
                  <Text className="font-display-x text-paper text-2xl">
                    {t('play.return.title')}
                  </Text>
                  <Feather
                    name="arrow-right-circle"
                    size={36}
                    color={palette.paper}
                  />
                </View>
              </Pressable>
            </RiseIn>

            {/* Section D: tips */}
            <RiseIn delay={180}>
              <View className="gap-3 mt-6">
                <TipRow icon="map-pin" text={t('play.tips.check_station')} />
                <TipRow icon="camera" text={t('play.tips.photo_return')} />
                <TipRow icon="alert-circle" text={t('play.tips.time_limit')} />
              </View>
            </RiseIn>

            {/* Section F: history */}
            <RiseIn delay={280}>
              <View className="mt-8 mb-3 flex-row items-center justify-between">
                <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs">
                  {t('play.history.label')}
                </Text>
                <Text className="font-mono text-ink/40 dark:text-paper/40 text-xs">
                  {historyCountLabel}
                </Text>
              </View>
              <View className="gap-2">
                {HISTORY.map((h) => (
                  <HistoryRow
                    key={h.id}
                    stationName={h.stationName}
                    sport={h.sport}
                    minutes={h.minutes}
                    timeLabel={relTime(h.hoursAgo)}
                  />
                ))}
              </View>
            </RiseIn>
          </>
        ) : (
          <>
            {/* Section E: empty-state hero */}
            <RiseIn delay={0}>
              <View className="bg-butter rounded-3xl p-8 mt-4 items-center">
                <Feather name="zap" size={64} color={palette.ink} />
                <Text className="font-display-x text-ink text-4xl text-center mt-4">
                  {t('play.empty.title')}
                </Text>
                <Text className="font-sans text-ink/70 text-base text-center mt-3">
                  {t('play.empty.sub')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="open map"
                  onPress={onOpenMap}
                  className="bg-coral rounded-2xl py-4 mt-6 w-full"
                  style={({ pressed }) => ({
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <Text className="font-semibold text-paper text-base text-center">
                    {t('play.empty.cta')}
                  </Text>
                </Pressable>
              </View>
            </RiseIn>

            {/* Section F: history */}
            <RiseIn delay={120}>
              <View className="mt-8 mb-3 flex-row items-center justify-between">
                <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs">
                  {t('play.history.label')}
                </Text>
                <Text className="font-mono text-ink/40 dark:text-paper/40 text-xs">
                  {historyCountLabel}
                </Text>
              </View>
              <View className="gap-2">
                {HISTORY.map((h) => (
                  <HistoryRow
                    key={h.id}
                    stationName={h.stationName}
                    sport={h.sport}
                    minutes={h.minutes}
                    timeLabel={relTime(h.hoursAgo)}
                  />
                ))}
              </View>
            </RiseIn>
          </>
        )}

        {__DEV__ ? (
          <Pressable
            onPress={onDevToggle}
            className="mt-8"
            hitSlop={8}
          >
            <Text className="font-mono text-xs text-ink/40 dark:text-paper/40 underline text-center">
              dev: {fakeActiveSession ? 'aktif seansı kapat' : 'aktif seans simüle et'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Return confirmation sheet */}
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['50%']}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: theme.bg }}
        handleIndicatorStyle={{ backgroundColor: theme.fg + '44' }}
      >
        <BottomSheetView
          style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }}
        >
          <Text className="font-display-x text-ink dark:text-paper text-3xl">
            {t('play.return.confirm_title')}
          </Text>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base mt-3">
            {t('play.return.confirm_sub')}
          </Text>
          <View className="flex-row gap-3 mt-6">
            <Pressable
              accessibilityRole="button"
              onPress={onCancelReturn}
              className="flex-1 border border-ink/20 dark:border-paper/20 rounded-2xl py-4"
            >
              <Text className="font-medium text-ink dark:text-paper text-base text-center">
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirmReturn}
              className="flex-1 bg-ink dark:bg-paper rounded-2xl py-4"
            >
              <Text className="font-semibold text-paper dark:text-ink text-base text-center">
                {t('play.return.confirm_cta')}
              </Text>
            </Pressable>
          </View>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

