import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_LABELS, STATIONS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useMapStore } from '@/stores/mapStore';
import {
  reservationSecondsRemaining,
  useReservationState,
  useReservationsApi,
  type Reservation,
} from '@/lib/reservations';

function fmt(sec: number) {
  if (sec <= 0) return '0:00';
  const mm = Math.floor(sec / 60).toString().padStart(2, '0');
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function stationName(stationId: string): string {
  return STATIONS.find((s) => s.id === stationId)?.name ?? stationId;
}

function ActiveReservationCard({
  r,
  onCancel,
}: {
  r: Reservation;
  onCancel: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const cacheStation = useMapStore((s) => s.cacheStation);
  const [secondsLeft, setSecondsLeft] = useState(() => reservationSecondsRemaining(r));

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(reservationSecondsRemaining(r)), 1000);
    return () => clearInterval(id);
  }, [r]);

  const onOpen = async () => {
    await hx.tap();
    const s = STATIONS.find((x) => x.id === r.station_id);
    if (s) cacheStation(s);
    router.push({ pathname: '/station/[id]', params: { id: r.station_id } });
  };

  return (
    <View
      style={{
        backgroundColor: palette.coral,
        borderRadius: 22,
        padding: 18,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: palette.paper + '26',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="lock" size={16} color={palette.paper} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            className="font-mono"
            style={{
              color: palette.paper + 'cc',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            {t('reservations.locked')}
          </Text>
          <Text
            className="font-display"
            style={{ color: palette.paper, fontSize: 18 }}
            numberOfLines={1}
          >
            {stationName(r.station_id)}
          </Text>
        </View>
        <Text
          className="font-mono"
          style={{
            color: palette.paper,
            fontSize: 22,
            letterSpacing: 0.5,
          }}
        >
          {fmt(secondsLeft)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 16 }}>{SPORT_EMOJI[r.sport]}</Text>
        <Text style={{ color: palette.paper + 'dd', fontSize: 13 }}>
          {SPORT_LABELS[r.sport]}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => ({
            flex: 1,
            backgroundColor: palette.paper,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: 'center',
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Text
            className="font-semibold"
            style={{ color: palette.coral, fontSize: 13 }}
          >
            {t('reservations.go_to_station')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: palette.paper + '55',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Text
            className="font-medium"
            style={{ color: palette.paper, fontSize: 13 }}
          >
            {t('reservations.cancel_short')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ReservationsPanel() {
  const { t } = useT();
  const { state, refresh } = useReservationState({ pollMs: 15_000 });
  const { cancel } = useReservationsApi();
  const active = state?.active ?? null;

  const onCancel = async () => {
    if (!active) return;
    await hx.tap();
    Alert.alert(
      t('reservations.cancel_title'),
      t('reservations.cancel_msg', { name: stationName(active.station_id) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('reservations.cancel_cta'),
          style: 'destructive',
          onPress: async () => {
            const res = await cancel(active.id);
            if (res.ok) hx.no();
            await refresh();
          },
        },
      ],
    );
  };

  if (active) {
    return (
      <View style={{ paddingTop: 8, gap: 12 }}>
        <ActiveReservationCard r={active} onCancel={onCancel} />
      </View>
    );
  }

  return (
    <View className="items-center mt-12 px-6">
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: palette.butter,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <Feather name="calendar" size={24} color={palette.ink} />
      </View>
      <Text className="font-display text-ink dark:text-paper text-base">
        {t('map.empty.no_reservations_title')}
      </Text>
      <Text className="font-sans text-ink/55 dark:text-paper/55 text-xs text-center mt-2">
        {t('map.empty.no_reservations_sub')}
      </Text>
    </View>
  );
}
