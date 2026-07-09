import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { palette, brand } from '@/constants/theme';
import { Button } from '@/components/ui';
import { SportBall } from '@/components/ui/SportBall';
import { useColorScheme } from '@/hooks/useColorScheme';
import { hx } from '@/lib/haptics';
import { useT } from '@/hooks/useT';
import { STATIONS, SPORT_LABELS, type Sport } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import {
  useReservationsApi,
  useReservationState,
  type CreateError,
} from '@/lib/reservations';

const SCREEN_W = Dimensions.get('window').width;

/**
 * Gate slugs are `${stationId}-${sport}-${n}` — surfacing the whole thing
 * reads as garbage to a user. Show only the short door label they recognise:
 * "K1", "K2", … (mirrors the reservations list).
 */
function gateLabel(gateId: string): string {
  const tail = gateId.split('-').pop();
  const n = Number(tail);
  if (Number.isFinite(n) && n > 0) return `K${n}`;
  return `K${gateId.slice(-1)}`;
}

// Per-sport ball tint (mirrors the session-prep hero). Dark = vivid, light =
// darker equivalents that stay legible on a light background.
function sportBallColor(sport: Sport, isDark: boolean): string {
  switch (sport) {
    case 'basketball':
      return brand.coral;
    case 'football':
      return isDark ? '#F4F3EE' : '#17181C';
    case 'volleyball':
      return isDark ? '#9A9AA6' : '#6B6B72';
    case 'tennis':
      return isDark ? '#D6FB3C' : '#5E7E00';
    default:
      return brand.coral;
  }
}

type SlideSpec = {
  iconName: keyof typeof Feather.glyphMap;
  iconBg: string;
  iconColor: string;
  pageBg?: string;
};

const SLIDES: SlideSpec[] = [
  { iconName: 'lock', iconBg: palette.ink + '0d', iconColor: palette.ink },
  { iconName: 'credit-card', iconBg: palette.ink + '0d', iconColor: palette.ink },
  { iconName: 'alert-triangle', iconBg: palette.coral + '22', iconColor: palette.coral, pageBg: palette.coral + '08' },
  { iconName: 'rotate-ccw', iconBg: palette.ink + '0d', iconColor: palette.ink },
];

export default function ReserveFlow() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const isDark = useColorScheme() === 'dark';
  const params = useLocalSearchParams<{ stationId: string; sport: string; gateId: string }>();

  const stationId = String(params.stationId);
  const sport = String(params.sport) as Sport;
  const gateId = String(params.gateId);
  // Look up the station the same way the reservations list does: the seed
  // list first (real, deployed units), then the persisted map cache (which
  // also holds the generated demo stations the user has seen). Without the
  // cache fallback the title degrades to the raw id (e.g. "gen-5-410110290-33").
  const stationCache = useMapStore((s) => s.stationCache);
  const station = useMemo(
    () => STATIONS.find((s) => s.id === stationId) ?? stationCache[stationId] ?? null,
    [stationId, stationCache],
  );

  const { state, loading, refresh } = useReservationState({ pollMs: 0, sweepBeforeFetch: false });
  const { create } = useReservationsApi();

  const needsSlides = useMemo(() => {
    if (!state) return null; // unknown until hydrated
    return (
      state.terms_version_accepted == null ||
      state.terms_version_accepted < state.terms_version_required
    );
  }, [state]);

  const holdAmount = state?.hold_amount_try ?? 20;
  const lockMin = 30; // canonical app_config value; UI doesn't need server round-trip for this

  const [pageIdx, setPageIdx] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const onClose = async () => {
    await hx.tap();
    // Always dismiss back to the map regardless of how the user got here
    // (map → reserve, or map → station → reserve). The reserve flow is
    // modal-shaped — X means close, not "pop one screen".
    router.dismissTo('/(tabs)/map');
  };

  const onConfirm = async () => {
    if (submitting) return;
    if (needsSlides === null) return; // still loading
    setSubmitting(true);
    await hx.tap();
    const res = await create({
      station_id: stationId,
      sport,
      gate_id: gateId,
      agreed: needsSlides ? agreed : true,
    });
    setSubmitting(false);
    if (res.ok) {
      await hx.yes();
      router.replace('/reservations');
      return;
    }
    handleError(res.error as CreateError, res);
  };

  const handleError = (
    code: CreateError,
    full: { reason?: string; locked_until?: string },
  ) => {
    hx.no();
    // Don't bounce the user off the reservation flow with a dialog — if
    // they just need a card, route them straight to /card-add. Card-add
    // calls router.back() on success, dropping them right where they
    // were so they can re-tap confirm with a card on file.
    if (code === 'no_card') {
      router.push('/card-add');
      return;
    }
    let key = `reservations.errors.${code}`;
    if (code === 'locked' && full.reason) {
      // Pull locale strings via the existing errors map; reason adds context.
      key = `reservations.errors.locked`;
    }
    const msg = t(key, { defaultValue: t('reservations.errors.bad_response') });
    Alert.alert(t('reservations.create_failed_title'), msg);
  };

  const goNext = async () => {
    await hx.tap();
    if (pageIdx < SLIDES.length - 1) {
      const next = pageIdx + 1;
      scrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
      setPageIdx(next);
    }
  };
  const goBack = async () => {
    await hx.tap();
    if (pageIdx === 0) return onClose();
    const prev = pageIdx - 1;
    scrollRef.current?.scrollTo({ x: prev * SCREEN_W, animated: true });
    setPageIdx(prev);
  };

  if (needsSlides === null || loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', color: palette.ink + '88' }}>...</Text>
      </View>
    );
  }

  // ============================================================
  // Mini-confirm path (repeat reservers, terms already accepted)
  // ============================================================
  if (!needsSlides) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper }}>
        <Header onBack={onClose} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingBottom: 12,
          }}
        >
          {/* Hero — the sport's own ball, tinted per sport + theme. */}
          <View style={{ alignItems: 'center', marginBottom: 22 }}>
            <SportBall sport={sport} color={sportBallColor(sport, isDark)} size={104} />
          </View>

          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              color: palette.ink + '80',
              fontSize: 12,
              letterSpacing: 3,
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            rezervasyon
          </Text>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 30,
              lineHeight: 36,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            {station?.name ?? stationId}
          </Text>

          {/* sport · gate chip */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 14 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: palette.surface + '1a',
                borderWidth: 1,
                borderColor: palette.ink + '1a',
              }}
            >
              <Text style={{ fontFamily: 'Unbounded_700Bold', color: palette.ink, fontSize: 12, letterSpacing: 0.3 }}>
                {SPORT_LABELS[sport] ?? sport}
              </Text>
              <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: palette.ink + '55' }} />
              <Text style={{ fontFamily: 'Unbounded_700Bold', color: palette.voltText, fontSize: 12, letterSpacing: 0.3 }}>
                {gateLabel(gateId)}
              </Text>
            </View>
          </View>

          {/* What reserving means — two clear rows instead of one gray line. */}
          <View
            style={{
              marginTop: 28,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: palette.ink + '14',
              backgroundColor: palette.surface + '0d',
              overflow: 'hidden',
            }}
          >
            <InfoRow
              icon="credit-card"
              title={`₺${holdAmount} geçici bloke`}
              sub="onaylayınca kartından bloke edilir, süre bitince çözülür"
            />
            <View style={{ height: 1, backgroundColor: palette.ink + '12', marginLeft: 70 }} />
            <InfoRow
              icon="clock"
              title={`${lockMin} dk senin için kilitli`}
              sub="kapı bu süre boyunca başkasına açılmaz"
            />
          </View>
        </ScrollView>

        <Footer
          insets={insets}
          left={
            <GhostButton
              label={t('reservations.mini_confirm.back')}
              onPress={onClose}
              disabled={submitting}
            />
          }
          right={
            <Button
              label={t('reservations.mini_confirm.confirm')}
              onPress={onConfirm}
              loading={submitting}
              size="md"
            />
          }
        />
      </View>
    );
  }

  // ============================================================
  // Slide deck path (first reservation)
  // ============================================================
  const isLast = pageIdx === SLIDES.length - 1;
  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <Header onBack={onClose} />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
      >
        {SLIDES.map((spec, i) => (
          <Slide
            key={i}
            spec={spec}
            title={t(`reservations.slides.title_${i + 1}`, { amount: holdAmount })}
            body={t(`reservations.slides.body_${i + 1}`, { amount: holdAmount })}
          />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 12 }}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={{
              width: i === pageIdx ? 18 : 6,
              height: 6,
              borderRadius: 3,
              marginHorizontal: 3,
              backgroundColor: i === pageIdx ? palette.ink : palette.ink + '33',
            }}
          />
        ))}
      </View>

      {isLast && (
        <Pressable
          onPress={async () => {
            await hx.tap();
            setAgreed((v) => !v);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          style={({ pressed }) => ({
            marginHorizontal: 24,
            marginBottom: 14,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 14,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: agreed ? palette.coral : palette.ink + '33',
              backgroundColor: agreed ? palette.coral + '14' : palette.paper,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: agreed ? palette.coral : palette.paper,
                borderWidth: 2.5,
                borderColor: agreed ? palette.coral : palette.ink,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
              }}
            >
              {agreed ? <Feather name="check" size={22} color={palette.paper} /> : null}
            </View>
            <Text
              style={{
                flex: 1,
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
                fontSize: 14,
                lineHeight: 20,
                letterSpacing: 0.1,
              }}
            >
              kuralları okudum, kabul ediyorum
            </Text>
          </View>
        </Pressable>
      )}

      <Footer
        insets={insets}
        left={
          <GhostButton
            label={t('reservations.slides.back')}
            onPress={goBack}
            disabled={submitting}
          />
        }
        right={
          isLast ? (
            <PrimaryButton
              label={t('reservations.slides.confirm')}
              onPress={onConfirm}
              loading={submitting}
              disabled={!agreed}
            />
          ) : (
            <PrimaryButton
              label={t('reservations.slides.next')}
              onPress={goNext}
            />
          )
        }
      />
    </View>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Header({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Pressable
        onPress={onBack}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="kapat"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.surface + '0d',
            borderWidth: 1,
            borderColor: palette.ink + '14',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="x" size={20} color={palette.ink} />
        </View>
      </Pressable>
    </View>
  );
}

function Slide({
  spec,
  title,
  body,
}: {
  spec: SlideSpec;
  title: string;
  body: string;
}) {
  return (
    <View
      style={{
        width: SCREEN_W,
        paddingHorizontal: 28,
        paddingTop: 12,
        paddingBottom: 24,
        backgroundColor: spec.pageBg ?? 'transparent',
        justifyContent: 'flex-start',
      }}
    >
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          backgroundColor: spec.iconBg,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 8,
          marginBottom: 28,
        }}
      >
        <Feather name={spec.iconName} size={38} color={spec.iconColor} />
      </View>
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 30,
          lineHeight: 35,
          marginBottom: 16,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          color: palette.ink + 'cc',
          fontSize: 15,
          lineHeight: 22,
        }}
      >
        {body}
      </Text>
    </View>
  );
}

function InfoRow({
  icon,
  title,
  sub,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  sub: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: palette.volt + '1f',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        <Feather name={icon} size={18} color={palette.voltText} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'Unbounded_700Bold', color: palette.ink, fontSize: 14, letterSpacing: 0.2 }}>
          {title}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            color: palette.ink + '99',
            fontSize: 12.5,
            lineHeight: 17,
            marginTop: 3,
          }}
        >
          {sub}
        </Text>
      </View>
    </View>
  );
}

function Footer({
  insets,
  left,
  right,
}: {
  insets: { bottom: number };
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 20,
        paddingBottom: insets.bottom + 14,
        paddingTop: 8,
      }}
    >
      <View style={{ flex: 1 }}>{left}</View>
      <View style={{ flex: 1.4 }}>{right}</View>
    </View>
  );
}

function GhostButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          paddingVertical: 14,
          borderRadius: 14,
          backgroundColor: palette.surface + '0d',
          borderWidth: 1,
          borderColor: palette.ink + '14',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.92 : 1,
      })}
    >
      <View
        style={{
          paddingVertical: 14,
          borderRadius: 14,
          backgroundColor: palette.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: palette.ink,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 10,
          elevation: 6,
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 14,
            letterSpacing: 0.3,
          }}
        >
          {loading ? '...' : label}
        </Text>
      </View>
    </Pressable>
  );
}
