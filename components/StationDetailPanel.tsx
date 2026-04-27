import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { palette } from '@/constants/theme';
import { SPORT_LABELS, type Station, type Sport } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { RiseIn } from '@/components/RiseIn';

export type StationDetailPanelProps = {
  station: Station;
  onSportTap: (sport: Sport) => void;
  /**
   * Optional reserve handler. When provided, each gate card shows a small
   * "rezerve et" link that takes the user to the hold-a-spot flow instead
   * of the immediate-unlock flow.
   */
  onReserveTap?: (sport: Sport) => void;
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
export function StationDetailPanel({ station, onSportTap, onReserveTap, headerSlot }: StationDetailPanelProps) {
  const { t } = useT();

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
                <Feather name="map-pin" size={14} color={palette.ink + '88'} />
                <Text className="font-sans text-ink/60 dark:text-paper/60 text-sm">
                  {station.city}
                </Text>
              </View>
              <View
                style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: palette.ink + '44' }}
              />
              <View className="flex-row items-center gap-1.5">
                <Feather name="clock" size={14} color={palette.ink + '88'} />
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
            <View>
              {station.sports.map((sport, idx) => {
                const n = idx + 1;
                const stock = station.stock[sport] ?? 0;
                const out = stock === 0 || !station.availableNow;
                return (
                  <View
                    key={sport}
                    style={{
                      backgroundColor: out ? palette.ink + '0d' : palette.paper,
                      borderWidth: 1.5,
                      borderColor: palette.ink + '22',
                      borderRadius: 20,
                      padding: 16,
                      marginBottom: 12,
                      opacity: out ? 0.55 : 1,
                    }}
                  >
                    {/* Top row: sport emoji + label + K{n} badge */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginBottom: 14,
                      }}
                    >
                      <Text style={{ fontSize: 36, marginRight: 12 }}>{SPORT_EMOJI[sport]}</Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontFamily: 'Unbounded_800ExtraBold',
                            color: palette.ink,
                            fontSize: 18,
                            letterSpacing: 0.2,
                          }}
                        >
                          {SPORT_LABELS[sport]}
                        </Text>
                        {out ? (
                          <Text
                            style={{
                              fontFamily: 'Inter_700Bold',
                              color: palette.coral,
                              fontSize: 12,
                              marginTop: 3,
                            }}
                          >
                            {t('station.full')}
                          </Text>
                        ) : (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              marginTop: 3,
                            }}
                          >
                            <View
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: '#3aaf6a',
                                marginRight: 6,
                              }}
                            />
                            <Text
                              style={{
                                fontFamily: 'Unbounded_700Bold',
                                color: palette.ink,
                                fontSize: 11,
                                letterSpacing: 0.6,
                                textTransform: 'uppercase',
                              }}
                            >
                              {t('station.available')}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View
                        style={{
                          backgroundColor: palette.ink,
                          borderRadius: 8,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: 'Unbounded_800ExtraBold',
                            color: palette.paper,
                            fontSize: 11,
                            letterSpacing: 0.4,
                          }}
                        >
                          K{n}
                        </Text>
                      </View>
                    </View>

                    {/* Action row: primary "ŞİMDİ OYNA" + secondary "REZERVE ET" */}
                    {!out ? (
                      <View style={{ flexDirection: 'row' }}>
                        <Pressable
                          onPress={() => onSportTap(sport)}
                          style={({ pressed }) => ({
                            flex: 1,
                            marginRight: 8,
                            opacity: pressed ? 0.92 : 1,
                          })}
                        >
                          <View
                            style={{
                              backgroundColor: palette.coral,
                              borderRadius: 14,
                              paddingVertical: 14,
                              alignItems: 'center',
                              flexDirection: 'row',
                              justifyContent: 'center',
                              shadowColor: palette.coral,
                              shadowOffset: { width: 0, height: 6 },
                              shadowOpacity: 0.28,
                              shadowRadius: 10,
                              elevation: 6,
                            }}
                          >
                            <Feather name="play" size={14} color={palette.paper} style={{ marginRight: 8 }} />
                            <Text
                              style={{
                                fontFamily: 'Unbounded_800ExtraBold',
                                color: palette.paper,
                                fontSize: 13,
                                letterSpacing: 0.4,
                              }}
                            >
                              ŞİMDİ OYNA
                            </Text>
                          </View>
                        </Pressable>
                        {onReserveTap ? (
                          <Pressable
                            onPress={() => onReserveTap(sport)}
                            style={({ pressed }) => ({
                              flex: 1,
                              opacity: pressed ? 0.6 : 1,
                            })}
                          >
                            <View
                              style={{
                                backgroundColor: palette.ink,
                                borderRadius: 14,
                                paddingVertical: 14,
                                alignItems: 'center',
                                flexDirection: 'row',
                                justifyContent: 'center',
                              }}
                            >
                              <Feather name="clock" size={14} color={palette.paper} style={{ marginRight: 8 }} />
                              <Text
                                style={{
                                  fontFamily: 'Unbounded_800ExtraBold',
                                  color: palette.paper,
                                  fontSize: 13,
                                  letterSpacing: 0.4,
                                }}
                              >
                                REZERVE ET
                              </Text>
                            </View>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        </RiseIn>
      </View>
    </View>
  );
}
