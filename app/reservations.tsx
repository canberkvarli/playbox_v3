import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useT } from '@/hooks/useT';
import { useMapStore } from '@/stores/mapStore';
import { STATIONS, SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import {
  isLockActive,
  lockSecondsRemaining,
  reservationSecondsRemaining,
  useReservationState,
  useReservationsApi,
  type Reservation,
  type ReservationLock,
  type ReservationStatus,
} from '@/lib/reservations';

const BG = palette.paper;
const TEXT = palette.ink;
const TEXT_MUTED = palette.ink;
const DIVIDER = palette.ink + '14';

function stationName(stationId: string): string {
  return STATIONS.find((s) => s.id === stationId)?.name ?? stationId;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 1) return `${mins} dk ${secs} sn`;
  return `${secs} sn`;
}

function formatLockRemaining(seconds: number): string {
  if (!Number.isFinite(seconds)) return '';
  if (seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 1) return `${hours}sa ${minutes}dk`;
  return `${minutes} dk`;
}

function ReservationCard({
  r,
  onCancel,
  onOpenStation,
  cancelling,
}: {
  r: Reservation;
  onCancel: () => void;
  onOpenStation: () => void;
  cancelling: boolean;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => reservationSecondsRemaining(r));

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(reservationSecondsRemaining(r)), 1000);
    return () => clearInterval(id);
  }, [r]);

  const expired = secondsLeft <= 0;

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
            {stationName(r.station_id)}
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
            {SPORT_LABELS[r.sport]} · KAPI {r.gate_id}
          </Text>
        </View>
      </View>

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
          {expired ? 'süresi doldu' : `${formatRemaining(secondsLeft)} kaldı`}
        </Text>
      </View>

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
          disabled={cancelling}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: TEXT + '22',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: cancelling ? 0.4 : pressed ? 0.5 : 1,
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

function LockBanner({
  lock,
  onPressCta,
}: {
  lock: ReservationLock;
  onPressCta: (reason: ReservationLock['reason']) => void;
}) {
  const { t } = useT();
  const [secondsLeft, setSecondsLeft] = useState(() => lockSecondsRemaining(lock));

  useEffect(() => {
    if (!Number.isFinite(secondsLeft)) return;
    const id = setInterval(() => setSecondsLeft(lockSecondsRemaining(lock)), 1000);
    return () => clearInterval(id);
  }, [lock, secondsLeft]);

  const titleKey = `reservations.lock_banner.${lock.reason}_title`;
  const subKey = `reservations.lock_banner.${lock.reason}_sub`;
  const ctaKey = `reservations.lock_banner.${lock.reason}_cta`;
  const remaining = formatLockRemaining(secondsLeft);

  const showCta = lock.reason === 'manual_review' || lock.reason === 'payment_failed';

  return (
    <View
      style={{
        backgroundColor: palette.coral + '14',
        borderColor: palette.coral + '44',
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 16,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="lock" size={16} color={palette.coral} />
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.coral,
            fontSize: 13,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          {t(titleKey)}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          color: TEXT,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {t(subKey, { remaining })}
      </Text>
      {showCta && (
        <Pressable
          onPress={() => onPressCta(lock.reason)}
          style={({ pressed }) => ({
            marginTop: 4,
            backgroundColor: palette.coral,
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.paper,
              fontSize: 13,
              letterSpacing: 0.5,
            }}
          >
            {t(ctaKey)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const STATUS_LABEL: Record<Exclude<ReservationStatus, 'active'>, string> = {
  consumed: 'reservations.status.consumed',
  cancelled: 'reservations.status.cancelled',
  expired_captured: 'reservations.status.expired_captured',
  expired_released: 'reservations.status.expired_released',
};

export default function Reservations() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const { state, refresh } = useReservationState({ pollMs: 15_000 });
  const { cancel } = useReservationsApi();
  const cacheStation = useMapStore((s) => s.cacheStation);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const active = state?.active ?? null;
  const recent = state?.recent ?? [];
  const lock = state?.lock && isLockActive(state.lock) ? state.lock : null;

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onCancel = (r: Reservation) => {
    hx.tap();
    Alert.alert(
      'Rezervasyonu iptal et?',
      'Bu rezervasyonu iptal etmek istediğinden emin misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: async () => {
            setCancelling(r.id);
            const res = await cancel(r.id);
            setCancelling(null);
            if (res.ok) {
              hx.no();
              await refresh();
              if (res.status === 'expired_captured') {
                Alert.alert(
                  t('reservations.status.expired_captured'),
                  t('reservations.notif.captured_body'),
                );
              }
            } else {
              const errKey = `reservations.errors.${res.error}`;
              Alert.alert(
                t('reservations.cancel_short'),
                t(errKey, { defaultValue: t('reservations.errors.bad_response') }),
              );
            }
          },
        },
      ],
    );
  };

  const onOpenStation = (r: Reservation) => {
    hx.tap();
    const station = STATIONS.find((s) => s.id === r.station_id);
    if (station) cacheStation(station);
    router.push({ pathname: '/station/[id]', params: { id: r.station_id } });
  };

  const onPressLockCta = (reason: ReservationLock['reason']) => {
    hx.tap();
    if (reason === 'payment_failed') router.push('/card-add');
    else if (reason === 'manual_review') router.push('/support');
  };

  const empty = !lock && !active && recent.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: DIVIDER,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="geri"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 12 })}
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
            color: TEXT,
            fontSize: 14,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          rezervasyonlar
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
        {lock ? <LockBanner lock={lock} onPressCta={onPressLockCta} /> : null}

        {empty ? (
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
              bir istasyon seç, kilitle, oyuna başlamak için 30 dk süren var.
            </Text>
            <Pressable
              onPress={async () => {
                await hx.tap();
                router.replace('/(tabs)/map');
              }}
              style={({ pressed }) => ({ marginTop: 6, opacity: pressed ? 0.92 : 1 })}
            >
              <View
                style={{
                  backgroundColor: palette.coral,
                  borderRadius: 16,
                  paddingVertical: 14,
                  paddingHorizontal: 28,
                  shadowColor: palette.coral,
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.28,
                  shadowRadius: 14,
                  elevation: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.paper,
                    fontSize: 15,
                    letterSpacing: 0.5,
                  }}
                >
                  haritayı aç
                </Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        {active ? (
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
            <ReservationCard
              r={active}
              onCancel={() => onCancel(active)}
              onOpenStation={() => onOpenStation(active)}
              cancelling={cancelling === active.id}
            />
          </>
        ) : null}

        {recent.length > 0 ? (
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
            {recent.map((r) => (
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
                    {stationName(r.station_id)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'JetBrainsMono_500Medium',
                      color: TEXT_MUTED,
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {r.status === 'active'
                      ? ''
                      : t(STATUS_LABEL[r.status as Exclude<ReservationStatus, 'active'>])}
                  </Text>
                </View>
                {r.status === 'expired_captured' && (
                  <Text
                    style={{
                      fontFamily: 'JetBrainsMono_500Medium',
                      color: palette.coral,
                      fontSize: 12,
                    }}
                  >
                    -₺{r.hold_amount_try}
                  </Text>
                )}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
