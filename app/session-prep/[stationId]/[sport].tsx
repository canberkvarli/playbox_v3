import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import {
  STATIONS,
  SPORT_LABELS,
  type Station,
  type Sport,
} from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useFreshPresence } from '@/stores/nearbyStore';
import { useStationInRange } from '@/lib/ble/useStationInRange';
import { useSessionStore } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useIyzico } from '@/lib/iyzico';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { CardRequiredSheet } from '@/components/CardRequiredSheet';
import { RiseIn } from '@/components/RiseIn';
import { scheduleSessionEndAlerts } from '@/lib/sessionNotifications';
import { getDriver } from '@/lib/hardware';
import { supabase } from '@/lib/supabase';
import { useGuardedPress } from '@/hooks/useGuardedPress';

const PREAUTH_HOLD_TRY = 150;

type StepKey = 'grab' | 'play' | 'ping' | 'return';

type StepConfig = {
  key: StepKey;
  icon: keyof typeof Feather.glyphMap;
  bg: string;
};

// Slides focus on the rules of the rental, not the unlock flow:
// 1. grab — take the gear
// 2. play — timer's running
// 3. ping — we'll remind you before time runs out
// 4. return — bring it back on time, intact, or pay extra
const STEPS: StepConfig[] = [
  { key: 'grab', icon: 'package', bg: palette.mauve },
  { key: 'play', icon: 'zap', bg: palette.coral },
  { key: 'ping', icon: 'bell', bg: palette.butter },
  { key: 'return', icon: 'rotate-ccw', bg: palette.ink },
];

export default function SessionPrep() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { stationId, sport, mode, duration, gateId: reservedGateId } =
    useLocalSearchParams<{
      stationId: string;
      sport: Sport;
      mode?: 'start' | 'howto';
      duration?: string;
      // The RESERVED gate's slug (`${stationId}-${sport}-${n}`), passed through
      // from the station screen's gate selector. Replayed verbatim as gate_id
      // for reservation linkage — NOT reconstructed here.
      gateId?: string;
    }>();
  const isHowto = mode === 'howto';
  // Duration arrives as a string param from /station/[id] (slider value the user
  // picked). Clamp to a sane range so an out-of-band value can't corrupt the
  // session or break the firmware's overdue calc. 30 is the historical default
  // used before duration was plumbed through.
  const durationMinutes = (() => {
    const n = Number.parseInt(duration ?? '', 10);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(n, 240);
  })();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);
  const startSession = useSessionStore((s) => s.startSession);

  const cardStatus = usePaymentStore((s) => s.cardStatus);
  const freeFirstUsed = usePaymentStore((s) => s.freeFirstUsed);
  const setHold = usePaymentStore((s) => s.setHold);
  const { preauthorize, releaseHold } = useIyzico();

  const station: Station | null = useMemo(() => {
    if (lastSelected && lastSelected.id === stationId) return lastSelected;
    return STATIONS.find((s) => s.id === stationId) ?? null;
  }, [stationId, lastSelected]);

  // DEV-001 is the no-card bench station (server honors dev_bypass for it), so
  // never force a card there — lets the real rent flow be tested without one.
  // Demo Mode (App Store review) also never requires a card — the whole rent
  // flow runs on the mock driver with no iyzico hold.
  const demoMode = useDevStore((s) => s.demoMode);
  const mustAddCardFirst =
    !demoMode && cardStatus === 'none' && freeFirstUsed && station?.id !== 'DEV-001';

  // --- Unlock pre-fetch ------------------------------------------------------
  // Stable correlationId for THIS prep session (== the firmware session_id).
  // Generated once so the background pre-sign below and the eventual onOyna
  // unlock use the SAME value (the pre-fetch cache is keyed on it).
  const correlationIdRef = useRef<string | null>(null);
  if (correlationIdRef.current === null) {
    correlationIdRef.current = `unlock:${stationId}:${sport}:${Date.now()}`;
  }
  const correlationId = correlationIdRef.current;

  // Pre-sign the unlock in the background while the user reads the prep slides,
  // so the final OYNA tap skips the sign-unlock round-trip and the door opens
  // sooner. Best-effort + additive: onOyna falls back to a fresh sign on a miss
  // (e.g. a real station whose payment hold isn't placed until onOyna runs).
  useEffect(() => {
    if (!station) return;
    const gateIdx = station.sports.indexOf(sport);
    getDriver().prefetchUnlock?.({
      stationId,
      gate: Math.max(1, gateIdx + 1),
      gateId: reservedGateId || undefined,
      correlationId,
      durationMin: durationMinutes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, sport, stationId, reservedGateId, correlationId, durationMinutes]);

  const [step, setStep] = useState(0);
  const [unlocking, setUnlocking] = useState(false);
  // Synchronous lock — React state updates are async, so a fast double-tap
  // can fire onOyna twice before unlocking flips. The ref blocks the second
  // call inside the same tick, preventing duplicate preauth holds.
  const unlockingRef = useRef(false);
  // Last-slide agreement gate (start mode only). User has to tick every rule
  // individually before "oyna" enables — captures granular, auditable consent.
  const [agreedRules, setAgreedRules] = useState<boolean[]>([
    false,
    false,
    false,
    false,
  ]);
  const agreed = agreedRules.every(Boolean);

  // Fresh-presence cue for the unlock CTA. Called unconditionally (before the
  // `!station` early return) so the hook order stays stable. `stationId` is
  // always a string param; the hook decays on its own 1s tick so the CTA goes
  // "not nearby" if the radio stops hearing this station.
  //
  // UX HONESTY ONLY — `present === false` SOFTENS the CTA copy and shows a
  // "yaklaş" nudge, but does NOT disable the button. The real BLE
  // scanAndConnect inside onOyna is the source of truth for presence: a user
  // who taps anyway gets a genuine connect-or-fail attempt, never a hard block
  // on a missing passive sighting.
  const { present: passivelyPresent } = useFreshPresence(stationId);

  // PASSIVE-ONLY presence is unreliable on this screen: nothing else is
  // scanning while the agreement slide is open, so no BLE advertisement ever
  // lands in nearbyStore and `passivelyPresent` stays false even when the user
  // is standing right at the station. Actively watch THIS station while the
  // screen is mounted — `useStationInRange` drives `getDriver().watchStation`,
  // which reports in_range on a live connection OR a fresh passive sighting.
  // Either signal counts as genuinely present, so the "yaklaş" nudge only
  // shows when the station truly isn't reachable.
  const { inRange: activelyPresent } = useStationInRange(stationId);
  const freshlyPresent = passivelyPresent || activelyPresent;

  if (!station) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.paper,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 16, left: 16 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Feather name="x" size={24} color={palette.ink} />
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 28,
            lineHeight: 33,
            textAlign: 'center',
          }}
        >
          {t('station.not_found')}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 14,
            textAlign: 'center',
            marginTop: 12,
            opacity: 0.7,
          }}
        >
          {t('station.not_found_sub')}
        </Text>
      </View>
    );
  }

  const gateIndex = station.sports.indexOf(sport);
  const n = gateIndex >= 0 ? gateIndex + 1 : 1;
  const sportLabel = SPORT_LABELS[sport] ?? sport;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const onBack = useGuardedPress(async () => {
    if (unlocking) return;
    await hx.tap();
    if (step === 0) {
      router.back();
    } else {
      setStep(step - 1);
    }
  }, 300);

  const onContinue = useGuardedPress(async () => {
    if (unlocking) return;
    if (isLast) {
      // Howto mode: this isn't a start-session flow, just an info read.
      // Tapping the last CTA dismisses the slides back to /play.
      if (isHowto) {
        await hx.tap();
        router.back();
        return;
      }
      // Start mode: agreement gate. The Oyna CTA is disabled until checked,
      // but guard here too in case state ever drifts.
      if (!agreed) return;
      return onOyna();
    }
    await hx.tap();
    setStep(step + 1);
  }, 300);

  // Disable advance on the last slide of start-mode until user agrees
  const ctaDisabled = unlocking || (isLast && !isHowto && !agreed);

  // Soft proximity cue on the unlock CTA: when the user is rules-agreed and
  // ready to unlock but the radio hasn't freshly heard this station, we relabel
  // the CTA to "yaklaş" and dim it — WITHOUT disabling it. Tapping still runs
  // the real scanAndConnect (source of truth), which will connect-or-fail. This
  // is honesty, not a security gate: never hard-block on a passive miss.
  const isUnlockCta = isLast && !isHowto;
  const softenForProximity =
    isUnlockCta && agreed && !unlocking && !freshlyPresent;

  const onOyna = async () => {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    setUnlocking(true);
    await hx.tap();

    let holdId: string | null = null;
    if (cardStatus === 'on_file' && !demoMode) {
      const conversationId = `${station.id}:${sport}:${Date.now()}`;
      const res = await preauthorize(PREAUTH_HOLD_TRY, conversationId);
      if (!res.ok) {
        setUnlocking(false);
        unlockingRef.current = false;
        await hx.punch();
        Alert.alert(t('card.preauth_failed.title'), t('card.preauth_failed.sub'), [
          { text: t('card.preauth_failed.cta_secondary'), style: 'cancel' },
          {
            text: t('card.preauth_failed.cta_primary'),
            onPress: () => router.push('/card-add'),
          },
        ]);
        return;
      }
      holdId = res.holdId;
      setHold(holdId);
    }

    // Pre-flight the session guard BEFORE the theatrics (haptics, timers).
    // If the user already has an active session we refuse, release any hold we
    // just placed, and point them at /play.
    const preflight = useSessionStore.getState().canStart(station.id);
    if (!preflight.ok) {
      await hx.no();
      if (holdId) {
        releaseHold(holdId).catch(() => {});
        setHold(null);
      }
      setUnlocking(false);
      unlockingRef.current = false;
      Alert.alert(
        t('common.error_generic'),
        preflight.reason === 'same_station_active'
          ? t('station.blocked_session_here')
          : t('station.blocked_session_elsewhere', {
              name: preflight.active.stationName,
            }),
        [{ text: 'Tamam', onPress: () => router.replace('/(tabs)/play') }]
      );
      return;
    }

    // Gate unlock — server-mediated through the active hardware driver.
    // Mock driver returns success instantly; BLE driver POSTs to the
    // /gate-unlock Edge Function which verifies session + dispatches MQTT.
    // Failure here MUST release the iyzico hold; we charged for an unlock
    // we never delivered.
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const sessionToken = authSession?.access_token ?? '';
    const driver = getDriver();
    // Reservation-linkage slug. This MUST equal the EXACT slug the reservation
    // holds (`reservations.gate_id`), which is the selected gate's id
    // (`${station.id}-${sport}-${gateNumberWithinSportStock}`) — produced by the
    // station screen's gate selector and threaded here as the `gateId` param.
    // The previous code rebuilt it from `gateIndex` (the SPORT'S ORDINAL in
    // station.sports), so every non-first sport / reserved gate > 1 produced a
    // mismatching slug and sign-unlock's `r.gate_id === gateId` linkage silently
    // failed. We now forward the real reserved slug verbatim, or OMIT it
    // (undefined → server logs "linkage skipped", a safe no-op) when it wasn't
    // plumbed through — never a reconstructed guess.
    // NOTE: this is the linkage SLUG only; the numeric `gate` used for the BLE
    // HMAC (derived inside the driver from this slug, and persisted below) is a
    // separate physical-compartment concern and is intentionally unchanged.
    const gateId = reservedGateId || undefined;
    // Numeric physical compartment for the BLE HMAC — UNCHANGED from before:
    // still the 1-indexed gate derived from the sport's position. Passed
    // explicitly (rather than re-parsed from the slug in the driver) so it stays
    // stable even when the linkage slug is omitted.
    const gate = Math.max(1, gateIndex + 1);
    // correlationId is the stable one generated at mount (also used by the
    // background pre-sign), so the pre-fetched payload matches this unlock.
    const unlockRes = await driver.unlockGate({
      stationId: station.id,
      gate,
      gateId,
      sessionToken,
      correlationId,
      durationMin: durationMinutes,
    });
    if (!unlockRes.ok) {
      if (holdId) {
        releaseHold(holdId).catch(() => {});
        setHold(null);
      }
      setUnlocking(false);
      unlockingRef.current = false;
      await hx.punch();
      const reasonMap: Record<string, string> = {
        not_in_range: 'kapıya yaklaş ve tekrar dene.',
        permission_denied: 'bluetooth izni gerekiyor — ayarlardan aç.',
        bluetooth_off: 'bluetooth\'u açıp tekrar dene.',
        connection_failed: 'kapı yanıt vermedi. tekrar dene.',
        auth_rejected: 'oturum doğrulanamadı, baştan başla.',
        gate_busy: 'kapı şu an meşgul. bir an sonra tekrar dene.',
        timeout: 'kapı yanıtı gelmedi. tekrar dene.',
        network: 'internet bağlantın yok gibi.',
        unsupported: 'bu cihaz kapı açmayı desteklemiyor.',
        unknown: 'bir sorun çıktı, tekrar dene.',
      };
      // permission_denied + bluetooth_off are recoverable only via Settings
      // — iOS won't reshow the BT prompt and won't toggle the radio for us.
      // Give the user a one-tap deep-link instead of a dead-end alert.
      const settingsRecoverable =
        unlockRes.error === 'permission_denied' ||
        unlockRes.error === 'bluetooth_off';
      Alert.alert(
        t('common.error_generic'),
        reasonMap[unlockRes.error] ?? reasonMap.unknown,
        settingsRecoverable
          ? [
              { text: 'iptal', style: 'cancel' },
              {
                text: 'ayarları aç',
                onPress: () => Linking.openSettings().catch(() => {}),
              },
            ]
          : [{ text: 'tamam' }],
      );
      return;
    }

    await new Promise((r) => setTimeout(r, 150));
    await hx.tap();
    await new Promise((r) => setTimeout(r, 150));
    await hx.punch();
    await new Promise((r) => setTimeout(r, 250));
    await hx.yes();
    // `correlationId` was the value the BLE driver passed to sign-unlock as
    // session_id; the firmware now stores it in activeSessionId[gate-1]. The
    // return_unlock flow on /(tabs)/play MUST replay this exact value or
    // firmware will silently drop the command. Persist both this and the
    // 1-indexed gate so the return path has everything it needs.
    const result = startSession({
      stationId: station.id,
      stationName: station.name,
      sport,
      durationMinutes,
      holdId,
      gate: Math.max(1, gateIndex + 1),
      bleSessionId: correlationId,
    });
    // Shouldn't fail after the pre-flight, but guard against a race where a
    // session was started in another surface between preflight and this call.
    if (!result.ok) {
      if (holdId) {
        releaseHold(holdId).catch(() => {});
        setHold(null);
      }
      setUnlocking(false);
      unlockingRef.current = false;
      router.replace('/(tabs)/play');
      return;
    }
    // Fire-and-forget local notification scheduling. Two alerts: 5 minutes
    // before the planned end + at the planned end. Cancelled on endSession.
    scheduleSessionEndAlerts({
      stationName: station.name,
      durationMinutes,
      startedAt: Date.now(),
    }).catch(() => {});
    router.replace('/(tabs)/play');
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingHorizontal: 16,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 16,
      }}
    >
      {/* Top row: back + progress */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
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
            <Feather
              name={step === 0 ? 'x' : 'arrow-left'}
              size={20}
              color={palette.ink}
            />
          </View>
        </Pressable>
        <OnboardingProgress total={STEPS.length} active={step} />
      </View>

      {/* Station context pill */}
      <View style={{ alignItems: 'flex-start', marginTop: 24 }}>
        <View
          style={{
            backgroundColor: palette.surface,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 999,
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.fg,
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            K{n} · {sportLabel} · {station.name}
          </Text>
        </View>
      </View>

      {/* Step content — key={step} re-triggers RiseIn on each advance */}
      <View key={step} style={{ flex: 1 }}>
        <RiseIn delay={0}>
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 13,
              letterSpacing: 2,
              marginTop: 32,
              textTransform: 'uppercase',
            }}
          >
            {step + 1} / {STEPS.length}
          </Text>
          <Text
            adjustsFontSizeToFit
            numberOfLines={1}
            minimumFontScale={0.5}
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 42,
              lineHeight: 50,
              marginTop: 8,
            }}
          >
            {t(`tour.steps.${current.key}.title`)}
          </Text>
        </RiseIn>

        {/* Hide description on the agreement slide so the rules can breathe;
            the bullets themselves are the message. */}
        {isLast && !isHowto ? null : (
          <RiseIn delay={80}>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink,
                fontSize: 17,
                lineHeight: 24,
                marginTop: 16,
              }}
            >
              {t(`tour.steps.${current.key}.desc`)}
            </Text>
          </RiseIn>
        )}

        {/* Last slide in start mode → animated checkbox rows. Each row
            staggers in on load and springs on tap. Once checked it locks
            (greys out + can't untoggle) so consent can't be revoked mid-flow. */}
        {isLast && !isHowto ? (
          <View style={{ flex: 1, marginTop: 24, marginBottom: 16 }}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 6 }}
            >
              {[
                'ekipmanı süre dolmadan iade edeceğim',
                'aldığım parçanın aynısını geri vereceğim',
                'kapıda hasar varsa hemen destek arayacağım',
                'gecikme veya eksik parça için ek ücret kesilir',
              ].map((line, idx) => (
                <AgreementRow
                  key={line}
                  label={line}
                  checked={agreedRules[idx]}
                  riseDelay={140 + idx * 90}
                  onToggle={async () => {
                    if (agreedRules[idx]) return; // locked once checked
                    await hx.tap();
                    setAgreedRules((prev) => {
                      const next = [...prev];
                      next[idx] = true;
                      return next;
                    });
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
        <RiseIn
          delay={160}
          style={{ flex: 1, marginTop: 32, marginBottom: 16 }}
        >
          <View
            style={{
              flex: 1,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: palette.ink + '14',
              backgroundColor: current.bg + (current.bg === palette.ink ? '' : '40'),
            }}
          >
            <View
              style={{
                width: 140,
                height: 140,
                borderRadius: 70,
                backgroundColor: current.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather
                name={current.icon}
                size={60}
                color={current.bg === palette.ink ? palette.paper : palette.ink}
              />
            </View>
          </View>
        </RiseIn>
        )}
      </View>

      {/* Pinned CTA — bg/shadow on the inner View so the Pressable
          function-style bug can never drop the colour and leave it white.
          Disabled state on the last slide of start mode until user agrees. */}
      <Pressable
        onPress={onContinue}
        disabled={ctaDisabled}
        accessibilityRole="button"
        accessibilityLabel={isLast ? t('prep.cta') : t('onb.intro_map.cta')}
        style={({ pressed }) => ({
          // softenForProximity dims like a disabled CTA but stays tappable.
          opacity: ctaDisabled || softenForProximity ? 0.55 : pressed ? 0.92 : 1,
        })}
      >
        <View
          style={{
            backgroundColor: unlocking
              ? palette.butter
              : isLast && !isHowto && !agreed
              ? palette.ink + '33' // gated grey until all rules are checked
              : softenForProximity
              ? palette.ink + '33' // not freshly nearby → softened "yaklaş" state
              : isLast && isHowto
              ? palette.ink
              : isLast
              ? palette.coral
              : palette.ink,
            borderRadius: 20,
            paddingVertical: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: isLast && !isHowto ? palette.coral : palette.ink,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.28,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          <Feather
            name={
              unlocking
                ? 'unlock'
                : softenForProximity
                ? 'map-pin'
                : isLast && isHowto
                ? 'check'
                : isLast
                ? 'play'
                : 'arrow-right'
            }
            size={22}
            color={unlocking ? palette.ink : palette.paper}
            style={{ marginRight: 10 }}
          />
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 19,
              letterSpacing: 0.5,
              color: unlocking ? palette.ink : palette.paper,
            }}
          >
            {unlocking
              ? t('prep.opening')
              : softenForProximity
              ? t('prep.approach')
              : isLast && isHowto
              ? 'anladım'
              : isLast
              ? t('prep.cta')
              : t('onb.intro_map.cta')}
          </Text>
        </View>
      </Pressable>

      {/* Gentle proximity nudge — shown only when the unlock CTA is softened
          because the radio hasn't freshly heard this station. Purely advisory;
          the button above stays tappable (real connect is source of truth). */}
      {softenForProximity ? (
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            fontSize: 13,
            textAlign: 'center',
            color: palette.ink,
            opacity: 0.6,
            marginTop: 10,
          }}
        >
          {t('prep.approach_hint')}
        </Text>
      ) : null}

      {mustAddCardFirst ? <CardRequiredSheet holdAmountTry={PREAUTH_HOLD_TRY} /> : null}
    </View>
  );
}

/**
 * One row of the agreement gate. Animated entry on mount (slide+fade in),
 * spring scale + check fade on toggle, and locks itself once checked so
 * consent is one-way only.
 */
function AgreementRow({
  label,
  checked,
  riseDelay,
  onToggle,
}: {
  label: string;
  checked: boolean;
  riseDelay: number;
  onToggle: () => void;
}) {
  // Entry: 0 → 1 over ~360ms with a stagger delay so rows ladder in.
  const enter = useSharedValue(0);
  // Check-mark fade-in: 0 unchecked → 1 checked.
  const checkV = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    enter.value = withDelay(riseDelay, withTiming(1, { duration: 380 }));
  }, [enter, riseDelay]);

  useEffect(() => {
    checkV.value = withSpring(checked ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [checked, checkV]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 16 }],
  }));

  const boxStyle = useAnimatedStyle(() => ({
    // Clamp checkV at 1 so the spring's overshoot can't scale the box ABOVE its
    // layout size (1.0). The overshoot was growing the checkbox past its 36px
    // box and pushing its edge into the screen margin on tap.
    transform: [{ scale: 0.9 + Math.min(checkV.value, 1) * 0.1 }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkV.value,
    transform: [{ scale: checkV.value }],
  }));

  const handlePress = () => {
    if (checked) return;
    onToggle();
  };

  return (
    <Animated.View style={[{ marginBottom: 18 }, rowStyle]}>
      <Pressable
        onPress={handlePress}
        disabled={checked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: checked }}
        // No opacity feedback when locked — the locked state has its own visuals.
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            opacity: checked ? 0.55 : 1,
          }}
        >
          <Animated.View
            style={[
              {
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: checked ? palette.ink + '33' : palette.paper,
                borderWidth: 2.5,
                borderColor: checked ? palette.ink + '55' : palette.ink,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
                flexShrink: 0,
              },
              boxStyle,
            ]}
          >
            <Animated.View style={checkStyle}>
              <Feather name="check" size={22} color={palette.ink} />
            </Animated.View>
          </Animated.View>
          <Text
            style={{
              flex: 1,
              flexShrink: 1,
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 14,
              lineHeight: 20,
              letterSpacing: 0.1,
            }}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
