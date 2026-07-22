import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette, brand } from '@/constants/theme';
import { useColorScheme } from '@/hooks/useColorScheme';
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
import { useIsDeveloper } from '@/hooks/useIsDeveloper';
import { usePaymentStore } from '@/stores/paymentStore';
import { useIyzico } from '@/lib/iyzico';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { SportBall } from '@/components/ui/SportBall';
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

// Per-sport ball tint for the "hazır mısın?" hero. Dark theme uses vivid
// on-brand colors; light theme swaps to darker equivalents that stay legible
// on a light background.
function sportBallColor(sport: Sport, isDark: boolean): string {
  switch (sport) {
    case 'basketball':
      return brand.coral; // coral on both themes
    case 'football':
      return isDark ? '#F4F3EE' : '#17181C'; // white on dark, ink on light
    case 'volleyball':
      return isDark ? '#9A9AA6' : '#6B6B72'; // gray on both themes
    case 'tennis':
      return isDark ? '#D6FB3C' : '#5E7E00'; // lime on dark, deep green on light
    default:
      return brand.coral;
  }
}

export default function SessionPrep() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

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
  const isDeveloper = useIsDeveloper();
  const mustAddCardFirst =
    !demoMode && cardStatus === 'none' && freeFirstUsed && station?.id !== 'DEV-001';

  // --- Unlock pre-fetch ------------------------------------------------------
  // Stable correlationId for THIS prep session (== the firmware session_id).
  // Generated once so the background pre-sign below and the eventual onOyna
  // unlock use the SAME value (the pre-fetch cache is keyed on it).
  const correlationIdRef = useRef<string | null>(null);
  if (correlationIdRef.current === null) {
    // Separators MUST be hyphens, not colons: this value is sent verbatim as
    // the BLE `session_id`, and the sign-unlock server restricts it to
    // /^[A-Za-z0-9-]{1,128}$/ (the HMAC string is pipe-delimited, so the charset
    // is locked down before signing). A colon here → server rejects with
    // `bad_session_id` → every OYNA fails with "kapı yanıt vermedi". stationId
    // ("DEV-001") and sport are already hyphen/alnum, so this stays valid.
    correlationIdRef.current = `unlock-${stationId}-${sport}-${Date.now()}`;
  }
  const correlationId = correlationIdRef.current;

  // Pre-sign the unlock in the background while the user reads the prep slides,
  // so the final OYNA tap skips the sign-unlock round-trip and the door opens
  // sooner. Best-effort + additive: onOyna falls back to a fresh sign on a miss
  // (e.g. a real station whose payment hold isn't placed until onOyna runs).
  useEffect(() => {
    if (!station || demoMode) return; // demo: no hardware, nothing to pre-sign
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
  // Proximity watch (NON-eager). We tried eager warm-connect here to make OYNA
  // instant, but holding a link from the prep screen created radio contention
  // and lingering half-open connections that destabilized the FW-state read and
  // map presence. Back to resting on the passive sighting; the OYNA connect is
  // reliable now via single-flight + the scan-stop settle + the firmware
  // name/conn-params reflash, so a clean ~2–3s connect-at-tap beats a flaky
  // instant one. (eager plumbing stays in the driver, just unused.)
  const { inRange: activelyPresent } = useStationInRange(stationId);
  // Demo Mode (App Store review): no hardware advertises, so count as present —
  // otherwise the "istasyona yaklaş" nudge shows on the slides even though the
  // mock unlock succeeds.
  const freshlyPresent = passivelyPresent || activelyPresent || demoMode;

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
  // Start mode is now a single "hazır mısın?" screen (no rules stepper); only
  // howto walks the 4 tour slides. isLast is therefore always true in start mode.
  const totalSteps = isHowto ? STEPS.length : 1;
  const current = STEPS[Math.min(step, STEPS.length - 1)];
  const isLast = step >= totalSteps - 1;

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
      // Start mode: straight to the real unlock (no rules gate anymore).
      return onOyna();
    }
    await hx.tap();
    setStep(step + 1);
  }, 300);

  const ctaDisabled = unlocking;

  // Soft proximity cue on the unlock CTA: when the user is rules-agreed and
  // ready to unlock but the radio hasn't freshly heard this station, we relabel
  // the CTA to "yaklaş" and dim it — WITHOUT disabling it. Tapping still runs
  // the real scanAndConnect (source of truth), which will connect-or-fail. This
  // is honesty, not a security gate: never hard-block on a passive miss.
  const isUnlockCta = isLast && !isHowto;
  const softenForProximity =
    isUnlockCta && !unlocking && !freshlyPresent;

  const onOyna = async () => {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    setUnlocking(true);
    await hx.tap();

    // Low-battery guard (like Martı): the renter needs their phone's BLE to
    // unlock AND to return the gear, so a dying phone can strand them + the
    // locker. Block below 15% unless charging. Demo-exempt; wrapped so it no-ops
    // on binaries without expo-battery (OTA-safe lazy require).
    if (!demoMode) {
      const MIN_BATTERY = 0.15; // 15%
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Battery = require('expo-battery');
        const { batteryLevel, batteryState } = await Battery.getPowerStateAsync();
        const charging =
          batteryState === Battery.BatteryState.CHARGING ||
          batteryState === Battery.BatteryState.FULL;
        if (batteryLevel >= 0 && batteryLevel < MIN_BATTERY && !charging) {
          setUnlocking(false);
          unlockingRef.current = false;
          await hx.no();
          Alert.alert(
            'şarjın çok düşük',
            `Kiralamak için telefon şarjın en az %${Math.round(
              MIN_BATTERY * 100,
            )} olmalı — dolabı açmak ve iade etmek için telefonuna ihtiyacın olacak.`,
            [{ text: 'tamam' }],
          );
          return;
        }
      } catch {
        // expo-battery not linked (older binary) or read failed → don't block.
      }
    }

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

    // Demo Mode (App Store review): never dead-end on a lingering session — clear
    // any active one first so OYNA always unlocks fresh for the reviewer.
    if (demoMode && useSessionStore.getState().active) {
      useSessionStore.getState().endSession();
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
    // Demo Mode (App Store review): there is NO hardware and NO Supabase session,
    // so never talk to the driver — a stale/BLE driver instance would return
    // connection_failed ("kapı yanıt vermedi") and dead-end the reviewer. Treat
    // the unlock as an instant success and fall through to startSession.
    const sessionToken = demoMode
      ? ''
      : (await supabase.auth.getSession()).data.session?.access_token ?? '';
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
    const unlockRes = demoMode
      ? ({ ok: true, openedAt: Date.now() } as const)
      : await driver.unlockGate({
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
      // Developer phone only: append the RAW driver error/message so a bench
      // failure is diagnosable on-device instead of hiding behind the generic
      // copy. Never shown to real users / App Store reviewers.
      const devDetail = isDeveloper
        ? `\n\n[dev] ${unlockRes.error}${
            unlockRes.message ? `: ${unlockRes.message}` : ''
          }`
        : '';
      Alert.alert(
        t('common.error_generic'),
        (reasonMap[unlockRes.error] ?? reasonMap.unknown) + devDetail,
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
        {isHowto ? (
          <OnboardingProgress total={STEPS.length} active={step} />
        ) : (
          <View style={{ width: 40 }} />
        )}
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
        {isHowto ? (
          <>
            <RiseIn delay={0}>
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  opacity: 0.6,
                  fontSize: 14,
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

            <RiseIn delay={160} style={{ flex: 1, marginTop: 32, marginBottom: 16 }}>
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
          </>
        ) : (
          // START MODE — one clean "ready to play" screen. No rules stepper,
          // no confirmation checks: OYNA runs the real unlock directly.
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <RiseIn delay={0}>
              <View style={{ alignItems: 'center' }}>
                {/* The session's own sport ball, tinted per sport + theme. */}
                <SportBall sport={sport} color={sportBallColor(sport, isDark)} size={132} />
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.ink,
                    fontSize: 34,
                    lineHeight: 40,
                    marginTop: 28,
                    textAlign: 'center',
                  }}
                >
                  hazır mısın?
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.ink,
                    opacity: 0.7,
                    fontSize: 16,
                    lineHeight: 23,
                    marginTop: 12,
                    textAlign: 'center',
                    paddingHorizontal: 12,
                  }}
                >
                  {durationMinutes} dakika planlandı · kapı açılınca sayaç başlar
                </Text>
              </View>
            </RiseIn>
          </View>
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
          {!unlocking && !softenForProximity && isLast && !isHowto ? (
            // Start-mode "oyna" CTA — the sport ball (paper-tinted for contrast
            // on the coral button), not a play triangle.
            <View style={{ marginRight: 10 }}>
              <SportBall sport={sport} color={palette.paper} size={22} />
            </View>
          ) : (
            <Feather
              name={
                unlocking
                  ? 'unlock'
                  : softenForProximity
                  ? 'map-pin'
                  : isLast && isHowto
                  ? 'check'
                  : 'arrow-right'
              }
              size={22}
              color={unlocking ? palette.ink : palette.paper}
              style={{ marginRight: 10 }}
            />
          )}
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
