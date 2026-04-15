import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { palette } from '@/constants/theme';
import { SPORT_LABELS, type Station, type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { RiseIn } from '@/components/RiseIn';

export type StationDetailPanelProps = {
  station: Station;
  onSportTap: (sport: Sport) => void;
  /**
   * Optional slot rendered at the very top of the panel — before the hero.
   * Host-specific controls (close button, back arrow, help) go here.
   */
  headerSlot?: React.ReactNode;
};

/**
 * Station detail content as a self-contained panel. No outer ScrollView,
 * no sticky CTA, no first-time tour sheet. The host decides how to wrap
 * this (bottom sheet's BottomSheetScrollView vs. a regular ScrollView).
 *
 * Per-sport cards (gates) are tappable — each card represents a numbered
 * gate (K1, K2, K3) and shows müsait / dolu status. Tap opens session-prep.
 */
export function StationDetailPanel({ station, onSportTap, headerSlot }: StationDetailPanelProps) {
  const { t } = useT();
  const theme = useTheme();

  const availableCount = station.sports.filter((s) => (station.stock[s] ?? 0) > 0).length;

  return (
    <View>
      {headerSlot}

      <View style={{ paddingHorizontal: 24, paddingTop: headerSlot ? 12 : 0 }}>
        {/* Hero card — sport emojis + gate count line */}
        <RiseIn delay={0}>
          <View
            style={{
              backgroundColor: palette.butter,
              borderRadius: 28,
              padding: 24,
              minHeight: 140,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: palette.ink + '1a',
            }}
          >
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

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 12,
                marginTop: 12,
              }}
            >
              {station.sports.map((s) => (
                <Text key={s} style={{ fontSize: 40 }}>
                  {SPORT_EMOJI[s]}
                </Text>
              ))}
            </View>
            <Text className="font-mono text-ink/60 text-xs text-center mt-4">
              {t('station.gate_count', {
                total: station.sports.length,
                available: availableCount,
              })}
            </Text>
          </View>
        </RiseIn>

        {/* Title block */}
        <RiseIn delay={80}>
          <View className="mt-6">
            <Text
              className="font-display-x text-ink dark:text-paper text-5xl"
              style={{ lineHeight: 48 }}
            >
              {station.name}
            </Text>
            <View className="flex-row items-center gap-4 mt-3">
              <View className="flex-row items-center gap-1.5">
                <Feather name="map-pin" size={14} color={theme.fg + '88'} />
                <Text className="font-sans text-ink/60 dark:text-paper/60 text-sm">
                  {station.city}
                </Text>
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

        {/* Gate grid — tappable sport cards with K{n} badges */}
        <RiseIn delay={160}>
          <View className="mt-8">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('station.available_equipment')}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {station.sports.map((sport, idx) => {
                const n = idx + 1;
                const stock = station.stock[sport] ?? 0;
                const out = stock === 0 || !station.availableNow;
                return (
                  <Pressable
                    key={sport}
                    onPress={() => {
                      if (out) return;
                      onSportTap(sport);
                    }}
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
                      <View
                        style={{
                          backgroundColor: palette.ink,
                          borderRadius: 6,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text
                          className="font-mono text-paper"
                          style={{ fontSize: 10 }}
                        >
                          K{n}
                        </Text>
                      </View>
                    </View>
                    <Text className="font-medium text-ink dark:text-paper text-base mt-3">
                      {SPORT_LABELS[sport]}
                    </Text>
                    {out ? (
                      <Text className="font-sans text-ink/40 dark:text-paper/40 text-xs mt-0.5">
                        {t('station.full')}
                      </Text>
                    ) : (
                      <View className="flex-row items-center gap-1.5 mt-0.5">
                        <Text className="font-medium text-ink dark:text-paper text-xs">
                          {t('station.available')}
                        </Text>
                        <View
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 2.5,
                            backgroundColor: palette.coral,
                          }}
                        />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </RiseIn>
      </View>
    </View>
  );
}
