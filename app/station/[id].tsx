import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS, SPORT_LABELS, type Station, type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useMapStore } from '@/stores/mapStore';
import { useSessionStore } from '@/stores/sessionStore';
import { RiseIn } from '@/components/RiseIn';

export default function StationDetail() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);
  const startSession = useSessionStore((s) => s.startSession);

  const station: Station | null = useMemo(() => {
    if (lastSelected && lastSelected.id === id) return lastSelected;
    return STATIONS.find((s) => s.id === id) ?? null;
  }, [id, lastSelected]);

  if (!station) {
    return (
      <View className="flex-1 bg-paper dark:bg-ink items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 16, left: 16 }}
        >
          <Feather name="x" size={24} color={theme.fg} />
        </Pressable>
        <Text className="font-display-x text-ink dark:text-paper text-3xl text-center">{t('station.not_found')}</Text>
        <Text className="font-sans text-ink/60 dark:text-paper/60 text-center mt-3">{t('station.not_found_sub')}</Text>
      </View>
    );
  }

  const totalStock = station.sports.reduce((acc, s) => acc + (station.stock[s] ?? 0), 0);
  const outOfStock = !station.availableNow || totalStock === 0;

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onUnlock = async (sport: Sport) => {
    if (outOfStock) return;
    await hx.punch();
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
      {/* Header with back button overlaying the hero area */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.bg,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.fg + '1a',
          }}
        >
          <Feather name="arrow-left" size={20} color={theme.fg} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 72,
          paddingBottom: insets.bottom + 140,
          paddingHorizontal: 24,
        }}
      >
        {/* Hero card — a stylized "station visual" */}
        <RiseIn delay={0}>
          <View
            style={{
              backgroundColor: palette.butter,
              borderRadius: 28,
              padding: 24,
              minHeight: 180,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: palette.ink + '14',
            }}
          >
            {/* Subtle grid pattern */}
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

            <Text className="font-mono text-ink/60 text-xs uppercase tracking-wider">
              {station.availableNow ? t('station.status.open') : t('station.status.closed')}
            </Text>
            <View className="flex-row items-center gap-2 mt-2">
              {station.availableNow && (
                <View
                  style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette.coral }}
                />
              )}
              <Text className="font-mono text-ink text-sm">ID · {station.id}</Text>
            </View>
          </View>
        </RiseIn>

        {/* Title block */}
        <RiseIn delay={80}>
          <View className="mt-6">
            <Text className="font-display-x text-ink dark:text-paper text-5xl" style={{ lineHeight: 48 }}>
              {station.name}
            </Text>
            <View className="flex-row items-center gap-4 mt-3">
              <View className="flex-row items-center gap-1.5">
                <Feather name="map-pin" size={14} color={theme.fg + '88'} />
                <Text className="font-sans text-ink/60 dark:text-paper/60 text-sm">{station.city}</Text>
              </View>
              <View
                style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.fg + '44' }}
              />
              <View className="flex-row items-center gap-1.5">
                <Feather name="clock" size={14} color={theme.fg + '88'} />
                <Text className="font-mono text-ink/60 dark:text-paper/60 text-sm">24/7</Text>
              </View>
            </View>
          </View>
        </RiseIn>

        {/* Stock grid — tappable sport cards */}
        <RiseIn delay={160}>
          <View className="mt-8">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('station.available_equipment')}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {station.sports.map((sport) => {
                const stock = station.stock[sport] ?? 0;
                const out = stock === 0;
                return (
                  <Pressable
                    key={sport}
                    onPress={() => onUnlock(sport)}
                    disabled={out}
                    style={({ pressed }) => ({
                      flexBasis: '47%',
                      flexGrow: 1,
                      backgroundColor: out ? theme.fg + '0d' : theme.bg,
                      borderWidth: 1,
                      borderColor: theme.fg + '1a',
                      borderRadius: 20,
                      padding: 16,
                      transform: [{ scale: pressed && !out ? 0.98 : 1 }],
                      opacity: out ? 0.55 : 1,
                    })}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text style={{ fontSize: 32 }}>{SPORT_EMOJI[sport]}</Text>
                      {!out && (
                        <View
                          style={{
                            backgroundColor: palette.coral,
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                          }}
                        />
                      )}
                    </View>
                    <Text className="font-medium text-ink dark:text-paper text-base mt-3">
                      {SPORT_LABELS[sport]}
                    </Text>
                    <Text className="font-mono text-ink/60 dark:text-paper/60 text-xs mt-0.5">
                      {out ? t('station.out_of_stock') : `${stock} ${t('station.units_available')}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </RiseIn>

        {/* How it works row */}
        <RiseIn delay={240}>
          <View className="mt-8 bg-paper dark:bg-ink rounded-2xl border border-ink/10 dark:border-paper/10 p-5">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('station.how_it_works')}
            </Text>
            <View className="gap-3">
              <View className="flex-row items-center gap-3">
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: palette.mauve + '26',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text className="font-display text-ink dark:text-paper text-sm">1</Text>
                </View>
                <Text className="font-sans text-ink dark:text-paper text-sm flex-1">
                  {t('station.steps.tap_sport')}
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: palette.mauve + '26',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text className="font-display text-ink dark:text-paper text-sm">2</Text>
                </View>
                <Text className="font-sans text-ink dark:text-paper text-sm flex-1">
                  {t('station.steps.scan_qr')}
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: palette.mauve + '26',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text className="font-display text-ink dark:text-paper text-sm">3</Text>
                </View>
                <Text className="font-sans text-ink dark:text-paper text-sm flex-1">
                  {t('station.steps.return')}
                </Text>
              </View>
            </View>
          </View>
        </RiseIn>
      </ScrollView>

      {/* Bottom primary CTA — sticky */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 24,
          paddingTop: 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: theme.bg,
          borderTopWidth: 1,
          borderTopColor: theme.fg + '0d',
        }}
      >
        <Pressable
          onPress={async () => {
            if (outOfStock) return;
            await hx.press();
            const firstSport = station.sports.find((s) => (station.stock[s] ?? 0) > 0);
            if (firstSport) onUnlock(firstSport);
          }}
          disabled={outOfStock}
          className={`${outOfStock ? 'bg-ink/20 dark:bg-paper/20' : 'bg-coral active:opacity-90'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && !outOfStock ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${outOfStock ? 'text-ink/50 dark:text-paper/50' : 'text-paper'} font-semibold text-lg text-center`}
          >
            {outOfStock ? t('station.cta_out_of_stock') : t('station.cta_unlock')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
