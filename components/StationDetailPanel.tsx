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
              backgroundColor: palette.surface,
              borderRadius: 28,
              padding: 24,
              minHeight: 140,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: palette.border,
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
                  backgroundColor: palette.border + '55',
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
                  backgroundColor: palette.border + '55',
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
            <Text className="font-mono text-muted text-xs text-center mt-4">
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
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.fg,
                fontSize: 24,
                lineHeight: 28,
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
              numberOfLines={2}
            >
              {station.name}
            </Text>
            <View className="flex-row items-center gap-4 mt-3">
              <View className="flex-row items-center gap-1.5">
                <Feather name="map-pin" size={14} color={palette.muted} />
                <Text className="font-sans text-muted text-sm">
                  {station.city}
                </Text>
              </View>
              <View
                style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: palette.border }}
              />
              <View className="flex-row items-center gap-1.5">
                <Feather name="clock" size={14} color={palette.muted} />
                <Text className="font-mono text-muted text-sm">24/7</Text>
              </View>
            </View>
          </View>
        </RiseIn>

        {/* Gate grid — tappable sport cards with K{n} badges */}
        <RiseIn delay={160}>
          <View className="mt-8">
            <Text className="font-medium text-muted uppercase tracking-wider text-xs mb-3">
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
                      backgroundColor: out ? palette.surface : palette.surfaceAlt,
                      borderWidth: 1.5,
                      borderColor: palette.border,
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
                            color: palette.fg,
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
                              color: palette.danger,
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
                                backgroundColor: palette.volt,
                                marginRight: 6,
                              }}
                            />
                            <Text
                              style={{
                                fontFamily: 'Unbounded_700Bold',
                                color: palette.voltText,
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
                          backgroundColor: palette.bg,
                          borderWidth: 1,
                          borderColor: palette.border,
                          borderRadius: 8,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: 'Unbounded_800ExtraBold',
                            color: palette.fg,
                            fontSize: 11,
                            letterSpacing: 0.4,
                          }}
                        >
                          K{n}
                        </Text>
                      </View>
                    </View>

                    {/* Action row: primary "ŞİMDİ OYNA" + secondary "REZERVE ET".
                        When out of stock we still want REZERVE ET available —
                        reserving for later is exactly the use-case. */}
                    <View style={{ flexDirection: 'row' }}>
                      {!out ? (
                        <Pressable
                          onPress={() => onSportTap(sport)}
                          style={({ pressed }) => ({
                            flex: 1,
                            marginRight: onReserveTap ? 14 : 0,
                            opacity: pressed ? 0.92 : 1,
                          })}
                        >
                          <View
                            style={{
                              backgroundColor: palette.volt,
                              borderRadius: 999,
                              paddingVertical: 14,
                              alignItems: 'center',
                              flexDirection: 'row',
                              justifyContent: 'center',
                              shadowColor: palette.volt,
                              shadowOffset: { width: 0, height: 6 },
                              shadowOpacity: 0.28,
                              shadowRadius: 10,
                              elevation: 6,
                            }}
                          >
                            <Feather name="play" size={14} color={palette.voltInk} style={{ marginRight: 8 }} />
                            <Text
                              style={{
                                fontFamily: 'Unbounded_800ExtraBold',
                                color: palette.voltInk,
                                fontSize: 13,
                                letterSpacing: 0.4,
                              }}
                            >
                              ŞİMDİ OYNA
                            </Text>
                          </View>
                        </Pressable>
                      ) : null}
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
                              backgroundColor: palette.surface,
                              borderWidth: 1.5,
                              borderColor: palette.border,
                              borderRadius: 999,
                              paddingVertical: 14,
                              alignItems: 'center',
                              flexDirection: 'row',
                              justifyContent: 'center',
                            }}
                          >
                            <Feather name="clock" size={14} color={palette.fg} style={{ marginRight: 8 }} />
                            <Text
                              style={{
                                fontFamily: 'Unbounded_800ExtraBold',
                                color: palette.fg,
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
