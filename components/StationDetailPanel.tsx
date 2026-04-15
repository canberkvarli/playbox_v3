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
  onUnlock: (sport: Sport) => void;
  /**
   * Optional slot rendered at the very top of the panel — before the hero.
   * Host-specific controls (close button, back arrow, help) go here.
   * When hosted in the station sheet, the sheet passes a close/help row.
   * When hosted in the deep-link route, the route passes nothing
   * (back arrow + help are positioned absolutely by the host).
   */
  headerSlot?: React.ReactNode;
};

/**
 * Station detail content as a self-contained panel. No outer ScrollView,
 * no sticky CTA, no first-time tour sheet. The host decides how to wrap
 * this (bottom sheet's BottomSheetScrollView vs. a regular ScrollView).
 *
 * Per-sport cards are the unlock affordance — tap a card to start a session.
 */
export function StationDetailPanel({ station, onUnlock, headerSlot }: StationDetailPanelProps) {
  const { t } = useT();
  const theme = useTheme();

  return (
    <View>
      {headerSlot}

      <View style={{ paddingHorizontal: 24, paddingTop: headerSlot ? 12 : 0 }}>
        {/* Hero card — stylized "station visual" */}
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

        {/* Stock grid — tappable sport cards (these are the unlock mechanism) */}
        <RiseIn delay={160}>
          <View className="mt-8">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('station.available_equipment')}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {station.sports.map((sport) => {
                const stock = station.stock[sport] ?? 0;
                const out = stock === 0 || !station.availableNow;
                return (
                  <Pressable
                    key={sport}
                    onPress={() => {
                      if (out) return;
                      onUnlock(sport);
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
                      {out
                        ? t('station.out_of_stock')
                        : `${stock} ${t('station.units_available')}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </RiseIn>

        {/* How it works */}
        <RiseIn delay={240}>
          <View className="mt-8 bg-paper dark:bg-ink rounded-2xl border border-ink/10 dark:border-paper/10 p-5">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('station.how_it_works')}
            </Text>
            <View className="gap-3">
              {(['tap_sport', 'scan_qr', 'return'] as const).map((key, i) => (
                <View key={key} className="flex-row items-center gap-3">
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
                    <Text className="font-display text-ink dark:text-paper text-sm">{i + 1}</Text>
                  </View>
                  <Text className="font-sans text-ink dark:text-paper text-sm flex-1">
                    {t(`station.steps.${key}`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </RiseIn>
      </View>
    </View>
  );
}
