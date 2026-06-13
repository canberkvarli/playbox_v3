import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore, type ActiveSession } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import { costForMs, formatTry, RATE_PER_MIN_GROSS } from '@/lib/pricing';
import { cancelSessionEndAlerts } from '@/lib/sessionNotifications';
import { getDriver } from '@/lib/hardware';
import { supabase } from '@/lib/supabase';
import { useStationInRange } from '@/lib/ble/useStationInRange';
import { stationClient } from '@/lib/ble/stationClient';
import { useT } from '@/hooks/useT';
import { GearReportSheet } from '@/components/GearReportSheet';
import { uploadReturnPhoto } from '@/lib/gear/uploadReturnPhoto';

// Safe-import expo-image-picker the same way GearReportSheet does — keeps the
// bundle from exploding if the native module isn't linked in some build, and
// lets the closing-photo affordance degrade to "just finish" gracefully.
let ImagePicker: any = null;
try {
  ImagePicker = require('expo-image-picker');
} catch {}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  // Under an hour: precise MM:SS clock. Over an hour: switch to Hsa Mdk so
  // the display doesn't bloat into "240:15" once the user forgets for a while.
  if (s < 3600) {
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}sa ${m}dk`;
}

function LiveTimer({ session }: { session: ActiveSession }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - session.startedAt;
  const total = session.durationMinutes * 60_000;
  const progress = Math.min(elapsed / Math.max(total, 1), 1);
  const overtime = elapsed > total;
  const remainingMs = Math.max(0, total - elapsed);
  const overMs = Math.max(0, elapsed - total);

  const accent = overtime ? palette.coral : palette.butter;

  return (
    <View
      style={{
        backgroundColor: palette.ink,
        borderRadius: 32,
        paddingVertical: 32,
        paddingHorizontal: 28,
        alignItems: 'center',
        shadowColor: palette.ink,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.22,
        shadowRadius: 24,
        elevation: 10,
      }}
    >
      <Text
        style={{
          fontFamily: 'JetBrainsMono_500Medium',
          color: accent + 'cc',
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}
      >
        geçen süre
      </Text>

      <Text
        style={{
          fontFamily: 'JetBrainsMono_400Regular',
          color: palette.paper,
          fontSize: 80,
          lineHeight: 86,
          letterSpacing: 3,
          marginTop: 6,
          includeFontPadding: false,
        }}
      >
        {fmt(elapsed)}
      </Text>

      {/* Progress bar — strokes full-width with overtime bleed */}
      <View
        style={{
          width: '100%',
          height: 8,
          backgroundColor: palette.paper + '1f',
          borderRadius: 4,
          marginTop: 22,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            backgroundColor: accent,
            borderRadius: 4,
          }}
        />
      </View>

      {/* Remaining status chip */}
      <View
        style={{
          marginTop: 18,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: overtime ? palette.coral : palette.paper + '14',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Feather
          name={overtime ? 'alert-triangle' : 'clock'}
          size={13}
          color={overtime ? palette.paper : accent}
          style={{ marginRight: 8 }}
        />
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: overtime ? palette.paper : accent,
            fontSize: 13,
            letterSpacing: 0.4,
          }}
        >
          {overtime
            ? `${fmt(overMs)} geciktin`
            : `${fmt(remainingMs)} kaldı`}
        </Text>
      </View>

      {/* Cost row — rate disclosure on the left, running accrued total on
          the right. Coral when overtime so the user feels the penalty. */}
      <View
        style={{
          marginTop: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 4,
          width: '100%',
        }}
      >
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.paper + '99',
            fontSize: 11,
            letterSpacing: 0.6,
          }}
        >
          {formatTry(RATE_PER_MIN_GROSS)}/dk · KDV dahil
        </Text>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: overtime ? palette.coral : palette.butter,
            fontSize: 16,
            letterSpacing: 0.4,
          }}
        >
          {formatTry(costForMs(elapsed))}
        </Text>
      </View>

      {/* Overtime breakdown — only when over the planned duration */}
      {overtime ? (
        <View
          style={{
            marginTop: 8,
            backgroundColor: palette.coral + '33',
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 6,
            alignSelf: 'stretch',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.paper,
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            ek ücret
          </Text>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              fontSize: 13,
              letterSpacing: 0.4,
            }}
          >
            +{formatTry(costForMs(overMs))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function Play() {
  const insets = useSafeAreaInsets();

  const active = useSessionStore((s) => s.active);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);

  const fakeActiveSession = useDevStore((s) => s.fakeActiveSession);
  const setFakeActiveSession = useDevStore((s) => s.setFakeActiveSession);
  const ignoreFirmwareTimeouts = useDevStore((s) => s.ignoreFirmwareTimeouts);
  const setIgnoreFirmwareTimeouts = useDevStore((s) => s.setIgnoreFirmwareTimeouts);

  // Mount a proximity watcher while there's an active session so BLE event
  // notifications (gate_closed, unlock_timeout, etc.) keep flowing from the
  // station into the session store. The watcher reuses the existing
  // connection if session-prep just opened one — no second scan, no
  // collision. When the session ends or the screen unmounts, the watcher
  // stops and the connection is left intact for any other screen that wants
  // it. Passing the station id triggers the hook; null when no session.
  useStationInRange(active?.stationId ?? null);

  // Cheap overtime tick — checked every 10s so the top-of-screen badge flips
  // shortly after the planned duration elapses without running a full 1Hz
  // re-render on the whole screen (the LiveTimer already does the per-second work).
  const [isOvertime, setIsOvertime] = useState(false);
  useEffect(() => {
    if (!active) {
      setIsOvertime(false);
      return;
    }
    const check = () => {
      const elapsed = Date.now() - active.startedAt;
      setIsOvertime(elapsed > active.durationMinutes * 60_000);
    };
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    // Dev-only fake-session simulator. Hard-gated on __DEV__ so a stale
    // store value can never trigger this in a production build.
    if (!__DEV__) return;
    if (fakeActiveSession && !active) {
      startSession({
        stationId: 'ist-kadikoy',
        stationName: 'Kadıköy Moda Spor Vakfı',
        sport: 'football',
        durationMinutes: 30,
        startedAt: Date.now() - 7 * 60_000,
      });
    }
  }, [fakeActiveSession, active, startSession]);

  const onHowToFinish = async () => {
    await hx.tap();
    if (!active) return;
    router.push({
      pathname: '/session-prep/[stationId]/[sport]',
      params: { stationId: active.stationId, sport: active.sport, mode: 'howto' },
    });
  };

  const { t } = useT();
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Three-phase return flow:
  //   'confirm'         — user is reading the "we'll open the door" prompt
  //   'opening'         — BLE return_unlock write in flight (~500ms)
  //   'awaiting_close'  — door is open, waiting for either the firmware's
  //                       gate_closed event or the user's manual "kapattım"
  //                       confirmation. On bench without reeds, manual is
  //                       the only way out.
  const [returnPhase, setReturnPhase] = useState<
    'confirm' | 'opening' | 'awaiting_close'
  >('confirm');
  const returningRef = useRef(false);
  const finalizingRef = useRef(false);

  // Optional closing photo — captured during awaiting_close, BEFORE finalize.
  //   'idle'   — nothing yet
  //   'busy'   — picker open / uploading
  //   'saved'  — photo uploaded
  //   'failed' — capture/upload failed (still fully skippable)
  const [photoState, setPhotoState] = useState<
    'idle' | 'busy' | 'saved' | 'failed'
  >('idle');

  // Reset phase whenever the modal closes so the next open starts at 'confirm'.
  useEffect(() => {
    if (!endModalOpen) {
      setReturnPhase('confirm');
      returningRef.current = false;
      finalizingRef.current = false;
      setPhotoState('idle');
    }
  }, [endModalOpen]);

  const finalizeReturn = () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setEndModalOpen(false);
    if (fakeActiveSession) setFakeActiveSession(false);
    cancelSessionEndAlerts().catch(() => {});
    endSession();
    router.replace('/session-review');
  };

  // Auto-advance when the firmware confirms the door was closed. Only fires
  // while we're in awaiting_close — otherwise an early/stale event would jump
  // the user past the confirm step.
  useEffect(() => {
    if (returnPhase !== 'awaiting_close') return;
    if (!active?.returnConfirmed) return;
    finalizeReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPhase, active?.returnConfirmed]);

  const onFinishSession = async () => {
    await hx.punch();
    setEndModalOpen(true);
  };

  // Phase 'confirm' → 'opening': fire the return_unlock BLE write. On
  // success move to 'awaiting_close' and wait for either gate_closed or
  // a manual confirm. On failure revert to 'confirm' with an alert.
  const onConfirmOpen = async () => {
    if (returningRef.current) return;
    returningRef.current = true;
    setReturnPhase('opening');
    await hx.yes();

    const isFake = fakeActiveSession || !active?.bleSessionId || !active?.gate;
    if (!isFake && active) {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const sessionToken = authSession?.access_token ?? '';
      const driver = getDriver();
      const correlationId = `return:${active.stationId}:${active.bleSessionId}:${Date.now()}`;
      const res = await driver.returnGate({
        stationId: active.stationId,
        gate: active.gate!,
        sessionId: active.bleSessionId!,
        sessionToken,
        correlationId,
      });
      if (!res.ok) {
        await hx.punch();
        returningRef.current = false;
        setReturnPhase('confirm');
        const reasonMap: Record<string, string> = {
          not_in_range: 'istasyona yaklaş ve tekrar dene.',
          permission_denied: 'bluetooth izni gerekiyor.',
          bluetooth_off: 'bluetooth\'u açıp tekrar dene.',
          connection_failed: 'kapı yanıt vermedi. tekrar dene.',
          auth_rejected: 'oturum eşleşmedi. desteğe yaz.',
          timeout: 'kapı yanıt vermedi. tekrar dene.',
          unsupported: 'bu cihaz kapı açmayı desteklemiyor.',
          network: 'internet bağlantın yok gibi.',
          gate_busy: 'kapı şu an meşgul. bir an sonra tekrar dene.',
          unknown: 'bir sorun çıktı, tekrar dene.',
        };
        const settingsRecoverable =
          res.error === 'permission_denied' || res.error === 'bluetooth_off';
        Alert.alert(
          'iade başarısız',
          reasonMap[res.error] ?? reasonMap.unknown,
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
    }

    // BLE write OK (or fake session) — door is now physically opening.
    // Move to awaiting_close and let the user put the gear back. The
    // gate_closed event or a manual tap will trigger finalizeReturn().
    await hx.tap();
    returningRef.current = false;
    setReturnPhase('awaiting_close');
  };

  // OPTIONAL closing photo, captured as part of closing the door (during
  // awaiting_close, BEFORE finalize). Best-effort and fully skippable: a
  // missing module, a cancelled picker, or a failed upload never traps the
  // user — they can always just tap "kapattım, bitir". Mirrors the capture
  // that used to live on session-review.
  const addClosingPhoto = async () => {
    await hx.tap();
    if (!ImagePicker || !active) return; // module missing → silent no-op
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync?.();
      // Denied camera → fall back to the library so the user still has a way
      // to attach something. Both are optional.
      const launch =
        perm && perm.granted === false
          ? ImagePicker.launchImageLibraryAsync
          : ImagePicker.launchCameraAsync;
      const res = await launch({
        mediaTypes: 'images',
        quality: 0.6,
        base64: true,
        allowsEditing: false,
      });
      if (res?.canceled) return; // back to idle — user can finish or retry
      const asset = res?.assets?.[0];
      if (!asset) return;

      setPhotoState('busy');
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      const userId = authSession?.user?.id ?? null;
      const sid = active.bleSessionId ?? `return-${active.startedAt}`;
      if (!userId) {
        setPhotoState('failed');
        return;
      }
      const up = await uploadReturnPhoto(
        supabase,
        userId,
        sid,
        asset.base64 ?? asset.uri,
      );
      if (up.ok) {
        await hx.yes();
        setPhotoState('saved');
      } else {
        setPhotoState('failed');
      }
    } catch {
      // Pickers throw on some OEMs; swallow — photo stays optional.
      setPhotoState('failed');
    }
  };

  // Manual confirmation for awaiting_close. In production the reed switch
  // will usually fire gate_closed before the user can tap this; on bench
  // (no reeds) this is the only way out. Either way we proceed regardless of
  // whether a closing photo was added — the photo is never a gate.
  const onManualConfirmClosed = async () => {
    await hx.yes();
    finalizeReturn();
  };

  const onGoMap = async () => {
    await hx.tap();
    router.replace('/(tabs)/map');
  };

  if (!active) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.paper,
          paddingTop: insets.top + 40,
          paddingHorizontal: 24,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="zap" size={48} color={palette.ink + '44'} />
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 30,
            textAlign: 'center',
            marginTop: 18,
          }}
        >
          aktif seans yok
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 16,
            textAlign: 'center',
            marginTop: 10,
          }}
        >
          haritadan bir istasyona git ve oyna
        </Text>
        <Pressable
          onPress={onGoMap}
          style={({ pressed }) => ({ marginTop: 24, opacity: pressed ? 0.85 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 20,
              paddingVertical: 16,
              paddingHorizontal: 32,
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 14,
              elevation: 6,
            }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.paper,
                fontSize: 16,
              }}
            >
              haritayı aç
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 20,
      }}
    >
      {/* Header row: back pill + centered eyebrow (switches to overtime) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: isOvertime ? 12 : 20,
        }}
      >
        <Pressable
          onPress={onGoMap}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 1.5,
              borderColor: palette.ink + '33',
              backgroundColor: palette.ink + '0d',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="chevron-left" size={22} color={palette.ink} />
          </View>
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: isOvertime ? palette.coral : palette.ink,
            fontSize: 13,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          {isOvertime ? 'süre aşımı' : 'aktif seans'}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Firmware-event banners — only shown when the bench-mode toggle is
          OFF (otherwise the store flags stay clean). Each surfaces a real
          condition the station has reported back over BLE notifications. */}
      {active.unlockTimedOut ? (
        <FirmwareBanner
          icon="alert-triangle"
          tone="warn"
          title="kapı açıldı, sen yaklaşmadın"
          body="istasyon kapıyı geri kilitledi. seansı bitir ve gerekirse tekrar başlat."
          onReport={() => router.push('/support')}
        />
      ) : null}
      {active.returnTimedOut ? (
        <FirmwareBanner
          icon="rotate-ccw"
          tone="warn"
          title="kapıyı kapatmadın"
          body="kapı tekrar kilitlendi. iade işlemini yeniden başlat."
          onReport={() => router.push('/support')}
        />
      ) : null}
      {active.overdue ? (
        <FirmwareBanner
          icon="clock"
          tone="warn"
          title="istasyon süre aşımı sinyalledi"
          body="planladığın süreyi geçtin. ek dakika ücreti işliyor."
          onReport={() => router.push('/support')}
        />
      ) : null}
      {active.stationRebooted ? (
        <FirmwareBanner
          icon="refresh-cw"
          tone="alert"
          title="istasyon yeniden başladı"
          body="ekipmanı kontrol et. sorun varsa hemen destek ara."
          onReport={() => router.push('/support')}
        />
      ) : null}

      {/* Overtime banner — gap → marginRight on the icon to avoid Yoga
          gap inconsistencies. */}
      {isOvertime ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: palette.coral + '1f',
            borderColor: palette.coral + '55',
            borderWidth: 1,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 16,
          }}
        >
          <Feather name="alert-triangle" size={18} color={palette.coral} style={{ marginRight: 10 }} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 14,
              lineHeight: 20,
            }}
          >
            planladığın süreyi geçtin. her ek dakika için ücretlendirileceksin.
          </Text>
        </View>
      ) : null}

      {/* Live timer hero */}
      <LiveTimer session={active} />

      {/* Station context strip — informational only. No card chrome, no
          rounded surface, no avatar circle, so users don't try to tap it. */}
      <View
        style={{
          marginTop: 18,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Feather name="map-pin" size={16} color={palette.ink} style={{ marginRight: 8 }} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 15,
            letterSpacing: 0.2,
          }}
        >
          {active.stationName}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: palette.ink + '0d',
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
          }}
        >
          <Text style={{ fontSize: 14, marginRight: 5 }}>{SPORT_EMOJI[active.sport]}</Text>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            {SPORT_LABELS[active.sport] ?? active.sport}
          </Text>
        </View>
      </View>

      {/* Two-up secondary actions — vivid tinted cards with an icon badge
          on the left and a label on the right. Reads as actionable cards,
          not faint outlined buttons. */}
      {/* Outer wrapper Views own the flex:1 + margin, so the row really
          splits 50/50 even on RN builds where Pressable function-style props
          get dropped. */}
      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <ActionCard
            icon="help-circle"
            label="nasıl bitirilir"
            sub="kapıyı kapat & bitir"
            tint={palette.butter}
            iconBg={palette.ink}
            iconColor={palette.paper}
            onPress={onHowToFinish}
          />
        </View>
        <View style={{ flex: 1 }}>
          <ActionCard
            icon="phone"
            label="destek"
            sub="hemen yardım al"
            tint={palette.coral + '22'}
            iconBg={palette.coral}
            iconColor={palette.paper}
            onPress={async () => {
              await hx.tap();
              router.push('/support');
            }}
          />
        </View>
      </View>

      <View style={{ flex: 1 }} />

      {/* Primary CTA — can't-miss coral with strong shadow */}
      <Pressable
        onPress={onFinishSession}
        accessibilityRole="button"
        accessibilityLabel="seansı bitir"
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <View
          style={{
            backgroundColor: palette.coral,
            borderRadius: 28,
            paddingVertical: 22,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: palette.coral,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.35,
            shadowRadius: 18,
            elevation: 12,
          }}
        >
          <Feather name="check" size={22} color={palette.paper} style={{ marginRight: 12 }} />
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              fontSize: 22,
              letterSpacing: 1.2,
            }}
          >
            seansı bitir
          </Text>
        </View>
      </Pressable>

      {/* Report-a-problem — subtle text link under the primary CTA. Opens the
          gear report sheet with the active session context. Best-effort: never
          disturbs the return flow above. */}
      <Pressable
        onPress={async () => {
          await hx.tap();
          setReportOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('gear.report.title')}
        hitSlop={8}
        style={{ marginTop: 14, alignSelf: 'center' }}
      >
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink + '88',
            fontSize: 13,
            textDecorationLine: 'underline',
          }}
        >
          {t('gear.report.title')}
        </Text>
      </Pressable>

      {/* End-session confirmation modal — phase-aware sheet that walks the
          user through "open the door → put gear back → close it". */}
      <EndSessionModal
        visible={endModalOpen}
        phase={returnPhase}
        onCancel={() => {
          // Dismissable only while still in the confirm step. After the BLE
          // write has fired the door is physically open — closing the modal
          // would orphan the flow.
          if (returnPhase !== 'confirm') return;
          setEndModalOpen(false);
        }}
        onConfirmOpen={onConfirmOpen}
        onManualConfirmClosed={onManualConfirmClosed}
        onAddClosingPhoto={addClosingPhoto}
        photoState={photoState}
        accruedTry={costForMs(Date.now() - active.startedAt)}
      />

      <GearReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        bleSessionId={active.bleSessionId ?? null}
        stationId={active.stationId ?? null}
        gate={active.gate ?? null}
      />

      {__DEV__ ? (
        <View style={{ marginTop: 12 }}>
          <Pressable
            onPress={async () => {
              await hx.tap();
              setFakeActiveSession(!fakeActiveSession);
            }}
            hitSlop={8}
          >
            <Text
              style={{
                fontFamily: 'JetBrainsMono_400Regular',
                color: palette.ink + '55',
                fontSize: 11,
                textAlign: 'center',
                textDecorationLine: 'underline',
              }}
            >
              dev: {fakeActiveSession ? 'aktif seansı kapat' : 'aktif seans simüle et'}
            </Text>
          </Pressable>
          {/* Bench toggle — flip OFF once reed switches are wired so real
              timeout events from the firmware can flow into the app. */}
          <Pressable
            onPress={async () => {
              await hx.tap();
              setIgnoreFirmwareTimeouts(!ignoreFirmwareTimeouts);
            }}
            hitSlop={8}
            style={{ marginTop: 6 }}
          >
            <Text
              style={{
                fontFamily: 'JetBrainsMono_400Regular',
                color: palette.ink + '55',
                fontSize: 11,
                textAlign: 'center',
                textDecorationLine: 'underline',
              }}
            >
              dev: fw timeouts {ignoreFirmwareTimeouts ? 'görmezden geliniyor' : 'dinleniyor'}
            </Text>
          </Pressable>
          {/* Bench-only "I closed the gate" — stands in for the reed switch on
              units without one wired. Sends the UNSIGNED `sim_close` BLE
              command so the dev firmware advances UNLOCKED -> IN_USE (and the
              return door-closed edge). Shown for ANY active session on the bench
              (ignoreFirmwareTimeouts) as long as we know the gate — simulateClose
              just emits a BLE sim_close and no-ops in its try/catch if there's no
              real link (e.g. a fake session with no bleSessionId). */}
          {ignoreFirmwareTimeouts && active?.gate ? (
            <Pressable
              onPress={async () => {
                await hx.tap();
                try {
                  await stationClient.simulateClose(active.gate!);
                } catch (e) {
                  // Best-effort dev affordance — firmware may not be built with
                  // DEV_SIM_CLOSE, or the link may be down. Never disturb the UI.
                  console.warn('[dev] simulateClose failed', e);
                }
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="dev: kapıyı kapattım"
              style={({ pressed }) => ({ marginTop: 10, opacity: pressed ? 0.7 : 1 })}
            >
              {/* Bench-only affordance, restyled as a visibly tappable bordered
                  button (vs the old underlined link). Kept subtle/dashed so it
                  still reads as a dev tool, not a primary CTA. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignSelf: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  backgroundColor: palette.ink + '0d',
                  borderWidth: 1.5,
                  borderColor: palette.ink + '44',
                  borderStyle: 'dashed',
                }}
              >
                <Feather
                  name="tool"
                  size={13}
                  color={palette.ink + '99'}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    fontFamily: 'JetBrainsMono_500Medium',
                    color: palette.ink + '99',
                    fontSize: 12,
                    letterSpacing: 0.3,
                  }}
                >
                  dev: kapıyı kapattım (gate {active.gate})
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * End-session / return flow modal. Walks the user through three phases that
 * mirror the physical reality of what's about to happen:
 *
 *   confirm        — preview the steps, big "kapıyı aç" CTA, dismissable
 *   opening        — BLE return_unlock write in flight, both CTAs locked
 *   awaiting_close — door is physically open; show numbered steps + a
 *                    "kapattım, bitir" button. Auto-advances when the
 *                    firmware emits gate_closed (reed switch closed).
 *
 * The previous version asked the user to assert "kapı kapalı" BEFORE the
 * door had been opened for return, which was a bad mental model. The new
 * flow only asks for confirmation AFTER the physical step is done.
 */
function EndSessionModal({
  visible,
  phase,
  onCancel,
  onConfirmOpen,
  onManualConfirmClosed,
  onAddClosingPhoto,
  photoState,
  accruedTry,
}: {
  visible: boolean;
  phase: 'confirm' | 'opening' | 'awaiting_close';
  onCancel: () => void;
  onConfirmOpen: () => void | Promise<void>;
  onManualConfirmClosed: () => void | Promise<void>;
  onAddClosingPhoto: () => void | Promise<void>;
  photoState: 'idle' | 'busy' | 'saved' | 'failed';
  accruedTry: number;
}) {
  const dismissable = phase === 'confirm';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissable ? onCancel : () => {}}
      statusBarTranslucent
    >
      <Pressable
        onPress={dismissable ? onCancel : () => {}}
        style={{
          flex: 1,
          backgroundColor: '#00000080',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: palette.paper,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 36,
          }}
        >
          {/* Drag handle — fades out on non-dismissable phases so the user
              knows tapping outside won't help. */}
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: palette.ink + '22',
              marginBottom: 18,
              opacity: dismissable ? 1 : 0.3,
            }}
          />

          {phase === 'confirm' ? (
            <ConfirmPhase
              accruedTry={accruedTry}
              onConfirmOpen={onConfirmOpen}
              onCancel={onCancel}
            />
          ) : phase === 'opening' ? (
            <OpeningPhase />
          ) : (
            <AwaitingClosePhase
              accruedTry={accruedTry}
              onManualConfirmClosed={onManualConfirmClosed}
              onAddClosingPhoto={onAddClosingPhoto}
              photoState={photoState}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ConfirmPhase({
  accruedTry,
  onConfirmOpen,
  onCancel,
}: {
  accruedTry: number;
  onConfirmOpen: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const steps: Array<{ icon: keyof typeof Feather.glyphMap; text: string }> = [
    { icon: 'unlock', text: 'kapıyı açacağız' },
    { icon: 'package', text: 'ekipmanı yerine koy' },
    { icon: 'corner-down-left', text: 'kapıyı kapat' },
  ];

  return (
    <>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: palette.butter,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Feather name="rotate-ccw" size={30} color={palette.ink} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 28,
          lineHeight: 32,
        }}
      >
        iade edelim mi?
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          color: palette.ink,
          fontSize: 15,
          lineHeight: 21,
          marginTop: 8,
          opacity: 0.85,
        }}
      >
        kapıyı şimdi açacağız. sırasıyla şu adımları yap:
      </Text>

      <View style={{ marginTop: 18 }}>
        {steps.map((step, idx) => (
          <View
            key={step.text}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: palette.butter,
              borderRadius: 14,
              paddingVertical: 14,
              paddingHorizontal: 14,
              marginBottom: 10,
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: palette.ink,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 13,
                }}
              >
                {idx + 1}
              </Text>
            </View>
            <Feather
              name={step.icon}
              size={18}
              color={palette.ink}
              style={{ marginRight: 10 }}
            />
            <Text
              style={{
                flex: 1,
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
                fontSize: 14,
                letterSpacing: 0.2,
              }}
            >
              {step.text}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: palette.ink + '14',
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 13,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          şu ana kadar
        </Text>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 22,
            letterSpacing: 0.4,
          }}
        >
          {formatTry(accruedTry)}
        </Text>
      </View>

      <Pressable
        onPress={onConfirmOpen}
        accessibilityRole="button"
        accessibilityLabel="kapıyı aç"
        style={({ pressed }) => ({
          marginTop: 22,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View
          style={{
            backgroundColor: palette.coral,
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            shadowColor: palette.coral,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          <Feather
            name="unlock"
            size={20}
            color={palette.paper}
            style={{ marginRight: 10 }}
          />
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              fontSize: 17,
              letterSpacing: 0.4,
            }}
          >
            kapıyı aç
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="vazgeç"
        style={({ pressed }) => ({
          marginTop: 14,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            paddingVertical: 14,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.ink + '0d',
            borderWidth: 1.5,
            borderColor: palette.ink + '22',
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
            vazgeç
          </Text>
        </View>
      </Pressable>
    </>
  );
}

function OpeningPhase() {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: palette.coral,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Feather name="unlock" size={30} color={palette.paper} />
      </View>
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 24,
          textAlign: 'center',
        }}
      >
        kapı açılıyor...
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          color: palette.ink,
          fontSize: 14,
          opacity: 0.7,
          marginTop: 8,
          textAlign: 'center',
        }}
      >
        istasyona yazıyoruz, bir saniye
      </Text>
    </View>
  );
}

function AwaitingClosePhase({
  accruedTry,
  onManualConfirmClosed,
  onAddClosingPhoto,
  photoState,
}: {
  accruedTry: number;
  onManualConfirmClosed: () => void | Promise<void>;
  onAddClosingPhoto: () => void | Promise<void>;
  photoState: 'idle' | 'busy' | 'saved' | 'failed';
}) {
  return (
    <>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: palette.coral,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Feather name="check" size={30} color={palette.paper} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 28,
          lineHeight: 32,
        }}
      >
        kapı açık
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          color: palette.ink,
          fontSize: 15,
          lineHeight: 21,
          marginTop: 8,
          opacity: 0.85,
        }}
      >
        ekipmanı yerine koy ve kapıyı kapat.
      </Text>

      <View
        style={{
          marginTop: 18,
          backgroundColor: palette.butter,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Feather
          name="package"
          size={20}
          color={palette.ink}
          style={{ marginRight: 10 }}
        />
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.2,
          }}
        >
          1. ekipmanı yerine koy
        </Text>
      </View>
      <View
        style={{
          marginTop: 10,
          backgroundColor: palette.butter,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Feather
          name="corner-down-left"
          size={20}
          color={palette.ink}
          style={{ marginRight: 10 }}
        />
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.2,
          }}
        >
          2. kapıyı kapat
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: palette.ink + '14',
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 13,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          toplam
        </Text>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 22,
            letterSpacing: 0.4,
          }}
        >
          {formatTry(accruedTry)}
        </Text>
      </View>

      {/* PRIMARY action — always rendered, placed FIRST (right after the total)
          so the user is never stuck: this is the obvious solid CTA to finish.
          The optional photo button lives BELOW it as a clearly secondary action.
          Reed-equipped stations will usually fire gate_closed before the user
          reaches for this; on bench (no reeds) this is the only path forward. */}
      <Pressable
        onPress={onManualConfirmClosed}
        accessibilityRole="button"
        accessibilityLabel="kapattım, bitir"
        style={({ pressed }) => ({
          marginTop: 22,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View
          style={{
            backgroundColor: palette.ink,
            borderRadius: 18,
            paddingVertical: 18,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            shadowColor: palette.ink,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.25,
            shadowRadius: 14,
            elevation: 8,
          }}
        >
          <Feather
            name="check"
            size={20}
            color={palette.paper}
            style={{ marginRight: 10 }}
          />
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.paper,
              fontSize: 17,
              letterSpacing: 0.4,
            }}
          >
            kapattım, bitir
          </Text>
        </View>
      </Pressable>

      {/* Optional closing photo — SECONDARY, best-effort, fully skippable.
          Sits below the primary finish button so it never blocks it. Only
          shown when expo-image-picker is linked. Captures BEFORE finalize so
          the shot is keyed to this session; finishing works with or without
          a photo. */}
      {ImagePicker ? (
        <Pressable
          onPress={onAddClosingPhoto}
          disabled={photoState === 'busy'}
          accessibilityRole="button"
          accessibilityLabel="fotoğraf ekle"
          style={({ pressed }) => ({
            marginTop: 12,
            opacity: photoState === 'busy' ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 14,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: palette.ink + '08',
              borderWidth: 1.5,
              borderColor:
                photoState === 'saved' ? palette.ink + '44' : palette.ink + '22',
            }}
          >
            <Feather
              name={photoState === 'saved' ? 'check-circle' : 'camera'}
              size={18}
              color={palette.ink}
              style={{ marginRight: 10 }}
            />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
                fontSize: 14,
                letterSpacing: 0.2,
              }}
            >
              {photoState === 'busy'
                ? 'fotoğraf yükleniyor...'
                : photoState === 'saved'
                ? 'fotoğraf eklendi'
                : 'fotoğraf eklemek ister misin?'}
            </Text>
          </View>
        </Pressable>
      ) : null}

      {photoState === 'failed' ? (
        <Text
          style={{
            marginTop: 8,
            fontFamily: 'Inter_600SemiBold',
            color: palette.coral,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          fotoğraf eklenemedi — yine de bitirebilirsin.
        </Text>
      ) : null}

      <Text
        style={{
          marginTop: 12,
          fontFamily: 'JetBrainsMono_400Regular',
          color: palette.ink + '88',
          fontSize: 11,
          textAlign: 'center',
          lineHeight: 16,
        }}
      >
        istasyon kapı kapanışını sinyallediğinde otomatik biteriz.
      </Text>
    </>
  );
}

/**
 * Banner shown when the firmware reports a state the user should know about
 * (unlock_timeout, return_timeout, ball_overdue, station_reboot). Surfaces
 * the cause and offers a "bildir" link straight to support — the easiest
 * possible feedback path mid-session.
 *
 * `tone='warn'` is yellow/coral-tinted; `tone='alert'` is the harder red
 * for things that imply gear or station risk (reboots, integrity loss).
 */
function FirmwareBanner({
  icon,
  tone,
  title,
  body,
  onReport,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  tone: 'warn' | 'alert';
  title: string;
  body: string;
  onReport: () => void;
}) {
  const tint = tone === 'alert' ? palette.coral : palette.butter;
  const borderTint = tone === 'alert' ? palette.coral + '55' : palette.ink + '33';
  const accent = tone === 'alert' ? palette.coral : palette.ink;
  const onBody = palette.ink;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: tone === 'alert' ? palette.coral + '1f' : tint,
        borderColor: borderTint,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: accent,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <Feather name={icon} size={16} color={palette.paper} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: onBody,
            fontSize: 13,
            letterSpacing: 0.3,
            lineHeight: 18,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: onBody,
            fontSize: 13,
            lineHeight: 18,
            marginTop: 4,
            opacity: 0.85,
          }}
        >
          {body}
        </Text>
        <Pressable
          onPress={async () => {
            await hx.tap();
            onReport();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="bildir"
          style={({ pressed }) => ({
            marginTop: 8,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: palette.ink,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
            }}
          >
            <Feather
              name="message-circle"
              size={12}
              color={palette.paper}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.paper,
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              bildir
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Tinted-card secondary action with an icon badge on the left and a label
 * on the right. Used for the "nasıl bitirilir" / "destek" pair under the
 * active-session card so they read as inviting cards instead of faint
 * outlined buttons.
 */
function ActionCard({
  icon,
  label,
  sub,
  tint,
  iconBg,
  iconColor,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  sub: string;
  tint: string;
  iconBg: string;
  iconColor: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {/* Stacked layout — icon badge on top, label + sub below. Stacking
          frees up the full card width for text so "nasıl bitirilir" /
          "kapıyı kapat & bitir" don't get truncated by ellipsis. */}
      <View
        style={{
          backgroundColor: tint,
          borderRadius: 18,
          paddingVertical: 14,
          paddingHorizontal: 14,
          width: '100%',
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: iconBg,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
          }}
        >
          <Feather name={icon} size={20} color={iconColor} />
        </View>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.3,
            lineHeight: 18,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 12,
            lineHeight: 16,
            marginTop: 3,
            opacity: 0.75,
          }}
        >
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}
