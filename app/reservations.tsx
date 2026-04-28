import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useT } from '@/hooks/useT';
import { useMapStore } from '@/stores/mapStore';
import { CITY_LABELS, STATIONS, SPORT_LABELS, type Station } from '@/data/stations.seed';
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
const TEXT_MUTED = palette.ink + '99';
const DIVIDER = palette.ink + '14';

/**
 * Resolve a `station_id` back to its display station. Looks first in the
 * seed list (real, deployed stations), then in the persisted map cache (which
 * captures every station the user has seen on the map — including the
 * deterministically generated demo stations around their location).
 */
function useStationLookup() {
  const stationCache = useMapStore((s) => s.stationCache);
  return useMemo(() => {
    const map = new Map<string, Station>();
    for (const s of STATIONS) map.set(s.id, s);
    for (const id of Object.keys(stationCache)) {
      if (!map.has(id)) map.set(id, stationCache[id]);
    }
    return (id: string): Station | null => map.get(id) ?? null;
  }, [stationCache]);
}

/**
 * Gate IDs are constructed as `${stationId}-${sport}-${n}` (see
 * session-prep) — surfacing the whole thing reads as garbage. We only want
 * the short suffix the user thinks of: "K1", "K2", …
 */
function gateLabel(gateId: string): string {
  const tail = gateId.split('-').pop();
  const n = Number(tail);
  if (Number.isFinite(n) && n > 0) return `K${n}`;
  return `K${gateId.slice(-1)}`;
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

function ActiveReservationCard({
  r,
  station,
  onCancel,
  onOpenStation,
  cancelling,
}: {
  r: Reservation;
  station: Station | null;
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
  const lowTime = !expired && secondsLeft <= 5 * 60;
  const accent = expired ? palette.coral : lowTime ? palette.coral : palette.ink;
  const stationLabel = station?.name ?? 'istasyon';
  const cityLabel = station ? CITY_LABELS[station.city] : '';

  return (
    <View
      style={{
        backgroundColor: BG,
        borderRadius: 24,
        borderWidth: 1.5,
        borderColor: expired ? palette.coral + '55' : palette.ink + '1f',
        padding: 20,
        shadowColor: palette.ink,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
        elevation: 4,
      }}
    >
      {/* Top: emoji tile + station name + gate badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: palette.butter,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Text style={{ fontSize: 32 }}>{SPORT_EMOJI[r.sport]}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: TEXT,
              fontSize: 20,
              letterSpacing: 0.2,
              lineHeight: 24,
            }}
          >
            {stationLabel}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: TEXT_MUTED,
                fontSize: 11,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              {SPORT_LABELS[r.sport]}
            </Text>
            {cityLabel ? (
              <>
                <View
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: 1.5,
                    backgroundColor: palette.ink + '55',
                    marginHorizontal: 8,
                  }}
                />
                <Text
                  style={{
                    fontFamily: 'JetBrainsMono_500Medium',
                    color: TEXT_MUTED,
                    fontSize: 11,
                    letterSpacing: 0.8,
                    textTransform: 'uppercase',
                  }}
                >
                  {cityLabel}
                </Text>
              </>
            ) : null}
          </View>
        </View>
        <View
          style={{
            backgroundColor: palette.ink,
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              fontSize: 12,
              letterSpacing: 0.4,
            }}
          >
            {gateLabel(r.gate_id)}
          </Text>
        </View>
      </View>

      {/* Time + hold amount row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: 18,
          paddingTop: 16,
          borderTopWidth: 1,
          borderTopColor: DIVIDER,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: TEXT_MUTED,
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            kalan süre
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather
              name={expired ? 'alert-circle' : 'clock'}
              size={14}
              color={accent}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: accent,
                fontSize: 16,
                letterSpacing: 0.3,
              }}
            >
              {expired ? 'süresi doldu' : formatRemaining(secondsLeft)}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: TEXT_MUTED,
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            teminat
          </Text>
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: TEXT,
              fontSize: 16,
            }}
          >
            ₺{r.hold_amount_try}
          </Text>
        </View>
      </View>

      {/* Action row */}
      <View style={{ flexDirection: 'row', marginTop: 18 }}>
        <Pressable
          onPress={onOpenStation}
          style={({ pressed }) => ({
            flex: 1,
            marginRight: 10,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.28,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Feather name="navigation" size={14} color={palette.paper} style={{ marginRight: 8 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 13,
                letterSpacing: 0.6,
              }}
            >
              İSTASYONA GİT
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={cancelling}
          style={({ pressed }) => ({
            paddingHorizontal: 18,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: palette.ink + '22',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: cancelling ? 0.4 : pressed ? 0.5 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: TEXT,
              fontSize: 12,
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
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Feather name="lock" size={16} color={palette.coral} style={{ marginRight: 8 }} />
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
            marginTop: 12,
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

function CancelConfirmModal({
  visible,
  reservation,
  station,
  cancelling,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  reservation: Reservation | null;
  station: Station | null;
  cancelling: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!reservation) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: BG,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 20,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 48,
              height: 4,
              borderRadius: 2,
              backgroundColor: palette.ink + '22',
              marginBottom: 18,
            }}
          />
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: palette.coral + '1a',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Feather name="x" size={32} color={palette.coral} />
            </View>
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: TEXT,
                fontSize: 22,
                textAlign: 'center',
              }}
            >
              rezervasyonu iptal et?
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                color: TEXT_MUTED,
                fontSize: 13,
                lineHeight: 19,
                textAlign: 'center',
                marginTop: 10,
                maxWidth: 280,
              }}
            >
              {station?.name ?? 'istasyon'} · {SPORT_LABELS[reservation.sport]} ·{' '}
              {gateLabel(reservation.gate_id)} rezervasyonu iptal edilecek. Teminat tutarın
              kartına serbest bırakılır.
            </Text>
          </View>

          <Pressable
            onPress={onConfirm}
            disabled={cancelling}
            style={({ pressed }) => ({
              marginBottom: 10,
              opacity: cancelling ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                backgroundColor: palette.coral,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 14,
                  letterSpacing: 0.6,
                }}
              >
                {cancelling ? 'iptal ediliyor...' : 'EVET, İPTAL ET'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={onClose}
            disabled={cancelling}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <View
              style={{
                paddingVertical: 16,
                alignItems: 'center',
                borderRadius: 16,
                borderWidth: 1.5,
                borderColor: palette.ink + '22',
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: TEXT,
                  fontSize: 13,
                  letterSpacing: 0.4,
                }}
              >
                vazgeç
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function Reservations() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const { state, refresh } = useReservationState({ pollMs: 15_000 });
  const { cancel } = useReservationsApi();
  const lookupStation = useStationLookup();
  const cacheStation = useMapStore((s) => s.cacheStation);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Reservation | null>(null);

  const active = state?.active ?? null;
  const recent = state?.recent ?? [];
  const lock = state?.lock && isLockActive(state.lock) ? state.lock : null;

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onCancel = (r: Reservation) => {
    hx.tap();
    setConfirmTarget(r);
  };

  const performCancel = async () => {
    if (!confirmTarget) return;
    const r = confirmTarget;
    setCancelling(r.id);
    const res = await cancel(r.id);
    setCancelling(null);
    setConfirmTarget(null);
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
  };

  const onOpenStation = (r: Reservation) => {
    hx.tap();
    const station = lookupStation(r.station_id);
    if (station) cacheStation(station);
    router.push({ pathname: '/station/[id]', params: { id: r.station_id } });
  };

  const onPressLockCta = (reason: ReservationLock['reason']) => {
    hx.tap();
    if (reason === 'payment_failed') router.push('/card-add');
    else if (reason === 'manual_review') router.push('/support');
  };

  const empty = !lock && !active && recent.length === 0;
  const activeStation = active ? lookupStation(active.station_id) : null;
  const confirmStation = confirmTarget ? lookupStation(confirmTarget.station_id) : null;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 14,
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
        }}
      >
        {lock ? (
          <View style={{ marginBottom: 18 }}>
            <LockBanner lock={lock} onPressCta={onPressLockCta} />
          </View>
        ) : null}

        {empty ? (
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 72,
            }}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                backgroundColor: palette.butter,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              <Feather name="calendar" size={36} color={palette.ink} />
            </View>
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: TEXT,
                fontSize: 22,
                textAlign: 'center',
                marginBottom: 10,
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
                maxWidth: 280,
                lineHeight: 19,
                marginBottom: 22,
              }}
            >
              haritadan bir istasyon seç ve oyuna gelmeden 30 dk önceden kapı kilitle.
            </Text>
            <Pressable
              onPress={async () => {
                await hx.tap();
                router.replace('/(tabs)/map');
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
            >
              <View
                style={{
                  backgroundColor: palette.coral,
                  borderRadius: 16,
                  paddingVertical: 14,
                  paddingHorizontal: 28,
                  flexDirection: 'row',
                  alignItems: 'center',
                  shadowColor: palette.coral,
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.28,
                  shadowRadius: 14,
                  elevation: 8,
                }}
              >
                <Feather name="map" size={16} color={palette.paper} style={{ marginRight: 8 }} />
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
          <View style={{ marginBottom: 28 }}>
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                color: TEXT_MUTED,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              aktif rezervasyon
            </Text>
            <ActiveReservationCard
              r={active}
              station={activeStation}
              onCancel={() => onCancel(active)}
              onOpenStation={() => onOpenStation(active)}
              cancelling={cancelling === active.id}
            />
          </View>
        ) : null}

        {recent.length > 0 ? (
          <View>
            <Text
              style={{
                fontFamily: 'Inter_700Bold',
                color: TEXT_MUTED,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              geçmiş
            </Text>
            {recent.map((r) => {
              const station = lookupStation(r.station_id);
              const cityLabel = station ? CITY_LABELS[station.city] : '';
              const captured = r.status === 'expired_captured';
              return (
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
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: palette.ink + '08',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{SPORT_EMOJI[r.sport]}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: 'Unbounded_700Bold',
                        color: TEXT,
                        fontSize: 14,
                      }}
                    >
                      {station?.name ?? 'istasyon'}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: 'JetBrainsMono_500Medium',
                        color: TEXT_MUTED,
                        fontSize: 11,
                        marginTop: 4,
                        letterSpacing: 0.4,
                      }}
                    >
                      {SPORT_LABELS[r.sport]} · {gateLabel(r.gate_id)}
                      {cityLabel ? ` · ${cityLabel.toLowerCase()}` : ''}
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Inter_500Medium',
                        color:
                          r.status === 'cancelled'
                            ? TEXT_MUTED
                            : captured
                              ? palette.coral
                              : TEXT_MUTED,
                        fontSize: 11,
                        marginTop: 4,
                      }}
                    >
                      {r.status === 'active'
                        ? ''
                        : t(STATUS_LABEL[r.status as Exclude<ReservationStatus, 'active'>])}
                    </Text>
                  </View>
                  {captured ? (
                    <Text
                      style={{
                        fontFamily: 'Unbounded_700Bold',
                        color: palette.coral,
                        fontSize: 13,
                        marginLeft: 8,
                      }}
                    >
                      -₺{r.hold_amount_try}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <CancelConfirmModal
        visible={confirmTarget !== null}
        reservation={confirmTarget}
        station={confirmStation}
        cancelling={cancelling !== null}
        onClose={() => (cancelling ? null : setConfirmTarget(null))}
        onConfirm={performCancel}
      />
    </View>
  );
}
