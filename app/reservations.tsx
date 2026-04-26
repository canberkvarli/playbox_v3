import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useMapStore } from '@/stores/mapStore';
import {
  useReservationStore,
  type Reservation,
} from '@/stores/reservationStore';
import { STATIONS, SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';

// Everything locked to light theme for guaranteed readability.
const BG = palette.paper;
const TEXT = palette.ink;
const TEXT_MUTED = palette.ink + 'aa';
const DIVIDER = palette.ink + '10';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'süresi doldu';
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins >= 1) return `${mins} dk ${secs} sn`;
  return `${secs} sn`;
}

function ReservationCard({
  r,
  onCancel,
  onOpenStation,
}: {
  r: Reservation;
  onCancel: () => void;
  onOpenStation: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = r.expiresAt - now;
  const expired = remainingMs <= 0;

  return (
    <View
      style={{
        backgroundColor: BG,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: expired ? palette.coral + '55' : TEXT + '14',
        padding: 18,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            backgroundColor: palette.butter,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 28 }}>{SPORT_EMOJI[r.sport]}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: TEXT,
              fontSize: 17,
              letterSpacing: 0.2,
            }}
          >
            {r.stationName}
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: TEXT_MUTED,
              fontSize: 12,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            {SPORT_LABELS[r.sport]}
          </Text>
        </View>
      </View>

      {/* Countdown chip */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-start',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: expired ? palette.coral + '26' : palette.ink + '0f',
        }}
      >
        <Feather
          name={expired ? 'alert-circle' : 'clock'}
          size={13}
          color={expired ? palette.coral : TEXT}
        />
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: expired ? palette.coral : TEXT,
            fontSize: 12,
            letterSpacing: 0.3,
          }}
        >
          {expired ? 'süresi doldu' : `${formatRemaining(remainingMs)} kaldı`}
        </Text>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Pressable
          onPress={onOpenStation}
          style={({ pressed }) => ({
            flex: 1,
            backgroundColor: palette.coral,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.paper,
              fontSize: 14,
              letterSpacing: 1,
            }}
          >
            İSTASYONA GİT
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: TEXT + '22',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: TEXT,
              fontSize: 13,
              letterSpacing: 0.4,
            }}
          >
            iptal
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Reservations() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reservations = useReservationStore((s) => s.reservations);
  const cancel = useReservationStore((s) => s.cancel);
  const cacheStation = useMapStore((s) => s.cacheStation);

  const active = reservations.filter(
    (r) => r.status === 'active' && r.expiresAt > Date.now()
  );
  const past = reservations.filter(
    (r) => r.status !== 'active' || r.expiresAt <= Date.now()
  );

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onCancel = (id: string) => {
    hx.tap();
    Alert.alert(
      'Rezervasyonu iptal et?',
      'Bu rezervasyonu iptal etmek istediğinden emin misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: () => {
            cancel(id);
            hx.no();
          },
        },
      ]
    );
  };

  const onOpenStation = (r: Reservation) => {
    hx.tap();
    const station = STATIONS.find((s) => s.id === r.stationId);
    if (station) cacheStation(station);
    router.push({ pathname: '/station/[id]', params: { id: r.stationId } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: DIVIDER,
        }}
      >
        <Pressable onPress={onBack} hitSlop={14} style={{ padding: 4, marginLeft: -4 }}>
          <Feather name="chevron-left" size={26} color={TEXT} />
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: TEXT,
            fontSize: 18,
            letterSpacing: 0.2,
          }}
        >
          Rezervasyonlar
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: insets.bottom + 40,
          gap: 14,
        }}
      >
        {active.length === 0 && past.length === 0 ? (
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 72,
              gap: 14,
            }}
          >
            <Feather name="calendar" size={44} color={TEXT + '44'} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: TEXT,
                fontSize: 22,
                textAlign: 'center',
              }}
            >
              henüz rezervasyon yok
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                color: TEXT_MUTED,
                fontSize: 13,
                textAlign: 'center',
                maxWidth: 260,
                lineHeight: 19,
              }}
            >
              bir istasyon seç, kilitlе, oyuna başlamak için 30 dk süren var.
            </Text>
            <Pressable
              onPress={async () => {
                await hx.tap();
                router.replace('/(tabs)/map');
              }}
              style={({ pressed }) => ({
                backgroundColor: palette.coral,
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 28,
                marginTop: 6,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.paper,
                  fontSize: 14,
                  letterSpacing: 0.5,
                }}
              >
                haritayı aç
              </Text>
            </Pressable>
          </View>
        ) : null}

        {active.length > 0 ? (
          <>
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                color: TEXT_MUTED,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              aktif
            </Text>
            {active.map((r) => (
              <ReservationCard
                key={r.id}
                r={r}
                onCancel={() => onCancel(r.id)}
                onOpenStation={() => onOpenStation(r)}
              />
            ))}
          </>
        ) : null}

        {past.length > 0 ? (
          <>
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                color: TEXT_MUTED,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                marginTop: 18,
                marginBottom: 2,
              }}
            >
              geçmiş
            </Text>
            {past.slice(0, 10).map((r) => (
              <View
                key={r.id}
                style={{
                  backgroundColor: BG,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: DIVIDER,
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  opacity: 0.75,
                }}
              >
                <Text style={{ fontSize: 22 }}>{SPORT_EMOJI[r.sport]}</Text>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: TEXT,
                      fontSize: 14,
                    }}
                  >
                    {r.stationName}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'JetBrainsMono_500Medium',
                      color: TEXT_MUTED,
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {r.status === 'used'
                      ? 'kullanıldı'
                      : r.status === 'cancelled'
                      ? 'iptal edildi'
                      : 'süresi doldu'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
