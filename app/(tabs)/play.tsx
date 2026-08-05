import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore, type ActiveSession } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';
import { costForMs, formatTry, RATE_PER_MIN_GROSS } from '@/lib/pricing';
import { cancelSessionEndAlerts, fireDoneAlertNow } from '@/lib/sessionNotifications';
import { getDriver } from '@/lib/hardware';
import { supabase } from '@/lib/supabase';
import { recordPlaySession } from '@/lib/playSessions';
import { useStationInRange } from '@/lib/ble/useStationInRange';
import { useDoorState } from '@/lib/hardware/useDoorState';
import { stationClient } from '@/lib/ble/stationClient';
import { useT } from '@/hooks/useT';
import { GearReportSheet } from '@/components/GearReportSheet';
import { StepRail, type Step as StepRailStep } from '@/components/StepRail';
import { uploadReturnPhoto } from '@/lib/gear/uploadReturnPhoto';
import { compressReturnPhoto } from '@/lib/gear/compressPhoto';
import { Button, CircularTimer } from '@/components/ui';

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

/**
 * Small live-status dot for the active-session eyebrow — gently pulses so the
 * header reads as "live". Purely visual; carries no timer state.
 */
function PulseDot({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.5 + p.value * 0.5,
    transform: [{ scale: 0.85 + p.value * 0.4 }],
  }));
  return (
    <Animated.View
      style={[
        {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
          marginRight: 8,
        },
        style,
      ]}
    />
  );
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

  const accent = overtime ? palette.danger : palette.volt;

  // Comp target (Asphalt Volt): a single volt ring on the dark app bg — big
  // JetBrains Mono countdown in cream, muted caption. When overtime, the arc
  // switches to coral and the center shows how far past planned we are.
  // The `progress` prop drives the REMAINING fraction (arc empties as time
  // runs out), so we pass `1 - progress`.
  const remainingFraction = Math.max(0, 1 - progress);
  // Compact H:MM / MM:SS so the ring centre stays one line — the old "21sa 22dk"
  // wrapped and overflowed the ring on long overruns.
  const ringFmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  };
  const centerTime = overtime ? `+${ringFmt(overMs)}` : ringFmt(remainingMs);
  // Demo Mode (App Store review) sessions are free — never show a ₺ charge.
  const demoMode = useDevStore((s) => s.demoMode);
  const caption = demoMode
    ? `${session.durationMinutes} dk planlandı · ücretsiz`
    : overtime
    ? `${formatTry(costForMs(elapsed))} · ${formatTry(RATE_PER_MIN_GROSS)}/dk`
    : `${session.durationMinutes} dk planlandı · ${formatTry(costForMs(elapsed))}`;

  // Subtle "alive" pulse behind the ring — a soft accent halo that gently
  // breathes (scale + opacity). PURELY visual: it never touches the per-second
  // timer tick above; it just signals that the session is live.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.06 + pulse.value * 0.12,
    transform: [{ scale: 0.94 + pulse.value * 0.08 }],
  }));

  const HERO = 260;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
      {/* Breathing accent halo — sits behind the ring, non-interactive. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: HERO + 40,
            height: HERO + 40,
            borderRadius: (HERO + 40) / 2,
            backgroundColor: accent,
          },
          haloStyle,
        ]}
      />
      <CircularTimer
        progress={remainingFraction}
        time={centerTime}
        caption={caption}
        size={HERO}
        stroke={16}
        color={accent}
      />
    </View>
  );
}

export default function Play() {
  const insets = useSafeAreaInsets();

  const active = useSessionStore((s) => s.active);
  const startSession = useSessionStore((s) => s.startSession);
  const endSession = useSessionStore((s) => s.endSession);
  // Demo/review sessions are free — no accrued charge anywhere.
  const demoMode = useDevStore((s) => s.demoMode);

  const reopeningRef = useRef(false);
  const [reopening, setReopening] = useState(false);

  // FALLBACK door tracking for the "kapıyı aç" reopen button (Path 1), used
  // only when the reed can't tell us (no link, or that gate has no reed wired).
  // We assume the door is open right after WE open it — a fresh OYNA start or a
  // reopen tap — and auto-clear after a grace window (time to grab the gear and
  // shut the door). The real reed overrides this in BOTH directions below; see
  // `doorOpen`.
  const DOOR_OPEN_GRACE_MS = 25_000;
  const [assumedDoorOpen, setAssumedDoorOpen] = useState(false);
  const doorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markDoorOpen = (remainingMs: number = DOOR_OPEN_GRACE_MS) => {
    setAssumedDoorOpen(true);
    if (doorTimerRef.current) clearTimeout(doorTimerRef.current);
    doorTimerRef.current = setTimeout(
      () => setAssumedDoorOpen(false),
      Math.max(0, remainingMs),
    );
  };
  // A freshly-started session means OYNA just opened the door — reflect that so
  // the reopen button starts disabled and clears once they've had time to shut
  // it. Keyed on startedAt so it fires only for a genuinely new session, not on
  // every remount of an ongoing one.
  useEffect(() => {
    if (!active) return;
    const elapsed = Date.now() - active.startedAt;
    if (elapsed >= 0 && elapsed < DOOR_OPEN_GRACE_MS) {
      markDoorOpen(DOOR_OPEN_GRACE_MS - elapsed);
    }
    return () => {
      if (doorTimerRef.current) clearTimeout(doorTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.startedAt]);

  // THE REAL DOOR, off the reed switch — 'closed' | 'open' | 'unknown'.
  // Passive: reads INFO only over a link we already hold, never opens one, and
  // answers 'unknown' when it can't tell (no link, or no reed wired on that
  // gate — only gate 1 has one today).
  const liveDoor = useDoorState(active?.gate ?? null, !!active);

  // The reed wins in BOTH directions when it speaks: 'open' disables the reopen
  // button even after the 25s grace has lapsed (the door really is still
  // hanging open), and 'closed' re-enables it IMMEDIATELY instead of making the
  // user wait out a timer they already satisfied by shutting the door. Only
  // when the reed is silent do we fall back to the optimistic timer.
  const doorOpen =
    liveDoor === 'open' ? true : liveDoor === 'closed' ? false : assumedDoorOpen;

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

  // Overrun warning modal — a loud, one-time heads-up shown when the user opens
  // the active screen and the session is ALREADY past its planned time. The slim
  // inline pill stays as the persistent indicator.
  const [overrunModalOpen, setOverrunModalOpen] = useState(false);
  const overrunWarnedRef = useRef(false);
  useEffect(() => {
    if (overrunWarnedRef.current || !active) return;
    if (Date.now() > active.startedAt + active.durationMinutes * 60_000) {
      overrunWarnedRef.current = true;
      setOverrunModalOpen(true);
    }
  }, [active, isOvertime]);

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
    // Show the SAME bottom sheet as the real end-session flow, but in an
    // informational 'howto' phase (StepRail + a plain "anladım" close, no door
    // action). Was a full-screen route push to session-prep howto; the sheet is
    // lighter and matches the kapı-steps redesign.
    setReturnPhase('howto');
    setEndModalOpen(true);
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
    'howto' | 'confirm' | 'opening' | 'awaiting_close'
  >('confirm');
  const returningRef = useRef(false);
  const finalizingRef = useRef(false);
  // Fires the closing-camera exactly once per awaiting_close entry (so we don't
  // re-pop it after the user cancels or every render).
  const autoPhotoFiredRef = useRef(false);

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
      autoPhotoFiredRef.current = false;
      setPhotoState('idle');
    }
  }, [endModalOpen]);

  // Demo Mode (App Store review): treat the closing photo as already satisfied so
  // reviewers are never prompted for — or blocked by — a photo. Keeping photoState
  // out of 'idle' makes every gate (auto-open, finish-block, modal CTA) pass.
  useEffect(() => {
    if (demoMode && photoState === 'idle') setPhotoState('saved');
  }, [demoMode, photoState]);

  const finalizeReturn = () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setEndModalOpen(false);
    if (fakeActiveSession) setFakeActiveSession(false);
    cancelSessionEndAlerts().catch(() => {});
    // Distinctive finish buzz + a "done" chime. fireDoneAlertNow presents an
    // immediate notification so the sound plays even though we just cancelled
    // the scheduled end alert. Lives here so BOTH the manual and the auto
    // (gate_closed) finish paths fire it exactly once (finalizingRef guards).
    hx.alertDone();
    fireDoneAlertNow(active?.stationName ?? '');
    // Record the completed REAL session for profile stats BEFORE we clear it
    // from the store. Best-effort + a no-op in demo mode; never throws, so a
    // stats failure can't block the session-end flow. finalizingRef guards this
    // to exactly once per completed session (both manual + auto-close paths).
    if (active) recordPlaySession(active);
    endSession();
    router.replace('/session-review');
  };

  // Auto-advance out of awaiting_close. Only fires while we're in that phase —
  // otherwise an early/stale event would jump the user past the confirm step.
  //
  // The CAPTURED PHOTO is the completion signal: the shot of the ball back in
  // the box is the evidence we actually keep, and by the time the user has
  // framed it they have physically finished the return. Holding them for the
  // firmware's gate_closed on top of that is a second wait for something they
  // already did, so once a photo is captured (saved OR failed — a network
  // problem must never trap the user) we finish immediately.
  //
  // When no photo can exist — Demo Mode (App Store review: reviewers have
  // nothing to photograph and the camera never auto-opens) or no picker module
  // linked — there's no such signal, so fall back to the old behaviour and wait
  // for the firmware to confirm the door closed. The manual "kapattım, bitir"
  // button covers every remaining case, including a cancelled picker.
  useEffect(() => {
    if (returnPhase !== 'awaiting_close') return;
    const photoCaptured =
      !demoMode && !!ImagePicker && (photoState === 'saved' || photoState === 'failed');
    if (!photoCaptured && !active?.returnConfirmed) return;
    finalizeReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPhase, active?.returnConfirmed, photoState]);

  const onFinishSession = async () => {
    await hx.punch();
    setEndModalOpen(true);
  };

  // Re-open the gate mid-session — the user may have shut it by mistake or needs
  // back in. Same unlock as session-prep, but the session already exists so we
  // don't touch the session store. Demo/fake sessions succeed instantly (no BLE).
  const onReopen = async () => {
    if (reopeningRef.current || !active) return;
    reopeningRef.current = true;
    setReopening(true);
    await hx.tap();
    try {
      if (!(demoMode || fakeActiveSession || !active.gate)) {
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();
        const sessionToken = authSession?.access_token ?? '';
        const driver = getDriver();
        const res = await driver.unlockGate({
          stationId: active.stationId,
          gate: active.gate!,
          sessionToken,
          // Hyphens, not colons — this is signed as the BLE session_id and the
          // server enforces /^[A-Za-z0-9-]{1,128}$/ (see session-prep). A colon
          // → `bad_session_id`.
          correlationId: `reopen-${active.stationId}-${active.bleSessionId ?? active.startedAt}-${Date.now()}`,
          durationMin: active.durationMinutes,
        });
        if (!res.ok) {
          await hx.punch();
          const reasonMap: Record<string, string> = {
            not_in_range: 'kapıya yaklaş ve tekrar dene.',
            permission_denied: 'bluetooth izni gerekiyor — ayarlardan aç.',
            bluetooth_off: 'bluetooth\'u açıp tekrar dene.',
            connection_failed: 'kapı yanıt vermedi. tekrar dene.',
            auth_rejected: 'oturum doğrulanamadı.',
            gate_busy: 'kapı şu an meşgul. bir an sonra dene.',
            timeout: 'kapı yanıtı gelmedi. tekrar dene.',
            network: 'internet bağlantın yok gibi.',
            unsupported: 'bu cihaz kapı açmayı desteklemiyor.',
            unknown: 'bir sorun çıktı, tekrar dene.',
          };
          Alert.alert('kapı açılamadı', reasonMap[res.error] ?? reasonMap.unknown, [
            { text: 'tamam' },
          ]);
          return;
        }
      } else {
        await new Promise((r) => setTimeout(r, 450));
      }
      // Door is now open — disable reopen until the grace window lapses (Path 1
      // optimistic tracking; we can't read the reed live during a session).
      markDoorOpen();
      await hx.yes();
    } catch {
      await hx.punch();
      Alert.alert('kapı açılamadı', 'bir sorun çıktı, tekrar dene.', [{ text: 'tamam' }]);
    } finally {
      reopeningRef.current = false;
      setReopening(false);
    }
  };

  // Phase 'confirm' → 'opening': fire the return_unlock BLE write. On
  // success move to 'awaiting_close' and wait for either gate_closed or
  // a manual confirm. On failure revert to 'confirm' with an alert.
  const onConfirmOpen = async () => {
    if (returningRef.current) return;
    returningRef.current = true;
    setReturnPhase('opening');
    await hx.yes();

    // Demo Mode has no hardware — never call the BLE driver on return or it fails
    // with connection_failed and traps the reviewer. Treat it like a fake session
    // (local-only close), same as the unlock path in session-prep.
    const isFake = demoMode || fakeActiveSession || !active?.bleSessionId || !active?.gate;
    if (!isFake && active) {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const sessionToken = authSession?.access_token ?? '';
      const driver = getDriver();
      // Hyphens for consistency with the unlock/reopen session_ids (the return
      // itself replays the stored bleSessionId as session_id, but keep the
      // correlation token in the same server-safe charset).
      const correlationId = `return-${active.stationId}-${active.bleSessionId}-${Date.now()}`;
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

      // The photo is captured — the user is DONE. Mark it saved immediately so
      // they can close the door without waiting on the network, then push the
      // bytes to Storage in the BACKGROUND (best-effort, audit-only). A failed
      // upload is logged, never surfaced — no modal, never blocks the finish.
      await hx.yes();
      setPhotoState('saved');

      const sid = active.bleSessionId ?? `return-${active.startedAt}`;
      const rawBody = asset.base64 ?? asset.uri;
      const srcUri = asset.uri ?? null;
      void (async () => {
        try {
          const {
            data: { session: authSession },
          } = await supabase.auth.getSession();
          const userId = authSession?.user?.id ?? null;
          if (!userId) {
            console.warn('[return-photo] skipped — no authenticated user');
            return;
          }
          // Shrink before upload (resize + recompress) so the stored evidence is
          // ~10x smaller. Best-effort: if the manipulator isn't in this binary
          // (OTA) or it fails, fall back to the original capture bytes.
          let body = rawBody;
          if (srcUri) {
            const shrunk = await compressReturnPhoto(srcUri);
            if (shrunk?.base64) body = shrunk.base64;
          }
          const up = await uploadReturnPhoto(supabase, userId, sid, body);
          if (!up.ok) console.warn('[return-photo] upload failed:', up.error);
        } catch (e: any) {
          console.warn('[return-photo] background upload threw:', String(e?.message ?? e));
        }
      })();
    } catch (e: any) {
      // Picker itself threw (some OEMs) — photo stays optional, logged only.
      console.warn('[return-photo] picker threw:', String(e?.message ?? e));
    }
  };

  // Manual confirmation for awaiting_close. In production the reed switch
  // will usually fire gate_closed before the user can tap this; on bench
  // (no reeds) this is the only way out. Either way we proceed regardless of
  // whether a closing photo was added — the photo is never a gate.
  const onManualConfirmClosed = async () => {
    // The finish alert (haptic + chime) is fired inside finalizeReturn so the
    // manual and the auto (gate_closed) paths both get it exactly once.
    finalizeReturn();
  };

  // Auto-open the closing camera the instant the door-open screen appears, so
  // the mandatory photo isn't a hidden step the user has to hunt for. Fires
  // once per awaiting_close entry; if the user cancels, the primary CTA below
  // re-opens it (it never becomes a dead button).
  useEffect(() => {
    if (returnPhase !== 'awaiting_close') return;
    if (demoMode) return; // App Store review: never auto-open the camera
    if (!ImagePicker) return;
    if (photoState !== 'idle') return;
    if (autoPhotoFiredRef.current) return;
    autoPhotoFiredRef.current = true;
    void addClosingPhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPhase, photoState]);

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
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 28,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Money moment: strong centered empty state whose one job is to send
            the user to the map. Big Archivo Expanded headline, a muted line,
            and a large volt CTA that dominates the screen. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', paddingHorizontal: 32 }}>
          {/* Volt bolt badge — a warm, inviting anchor above the headline. */}
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: palette.volt,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 26,
              shadowColor: palette.volt,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.35,
              shadowRadius: 20,
              elevation: 10,
            }}
          >
            <Feather name="zap" size={40} color={palette.voltInk} />
          </View>

          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 40,
              lineHeight: 44,
              textAlign: 'center',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            aktif seans yok
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              color: palette.muted,
              fontSize: 16,
              lineHeight: 23,
              textAlign: 'center',
              marginTop: 14,
              maxWidth: 300,
            }}
          >
            haritadan bir istasyona git ve oyna
          </Text>
        </View>

        {/* Prominent, centered, LARGER primary CTA — volt pill, voltInk text,
            bigger than a standard Button (~58 tall, larger label). Keeps the
            existing onGoMap handler. */}
        <Pressable
          onPress={onGoMap}
          accessibilityRole="button"
          accessibilityLabel="haritayı aç"
          style={({ pressed }) => ({
            width: '100%',
            opacity: pressed ? 0.92 : 1,
          })}
        >
          <View
            style={{
              height: 68,
              borderRadius: 999,
              backgroundColor: palette.volt,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 24,
              shadowColor: palette.volt,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.35,
              shadowRadius: 18,
              elevation: 10,
            }}
          >
            <Feather name="map" size={24} color={palette.voltInk} style={{ marginRight: 12 }} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.voltInk,
                fontSize: 21,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
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
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: 8,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="chevron-left" size={22} color={palette.fg} />
          </View>
        </Pressable>
        {/* Comp header: a small VOLT dot + tracked JetBrains Mono line reading
            "<SPORT> · <STATION SHORT>". Station short = first token of the
            station name, uppercased (no dedicated short field on the session).
            Recolors coral on overtime, mirroring the old eyebrow behavior. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PulseDot color={isOvertime ? palette.danger : palette.volt} />
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              color: isOvertime ? palette.danger : palette.volt,
              fontSize: 13,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            {`${SPORT_LABELS[active.sport] ?? active.sport} · ${active.stationName.split(' ')[0]}`}
          </Text>
        </View>
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
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: palette.danger + '14',
            borderRadius: 999,
            paddingLeft: 10,
            paddingRight: 14,
            paddingVertical: 7,
            marginBottom: 14,
          }}
        >
          <Feather name="alert-triangle" size={14} color={palette.danger} style={{ marginRight: 7 }} />
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.danger,
              fontSize: 12.5,
              letterSpacing: 0.2,
            }}
          >
            planlanan süre doldu · ek dakika ücretli
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
        <Feather name="map-pin" size={16} color={palette.voltText} style={{ marginRight: 8 }} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.fg,
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
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1,
            borderColor: palette.border,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
          }}
        >
          <Text style={{ fontSize: 14, marginRight: 5 }}>{SPORT_EMOJI[active.sport]}</Text>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            {SPORT_LABELS[active.sport] ?? active.sport}
          </Text>
        </View>
      </View>

      {/* Quiet utility line — replaces the two heavy info cards. Keeps
          "nasıl bitirilir?" + destek reachable without eating the vertical
          space that was forcing a scroll. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 22,
        }}
      >
        <Pressable
          onPress={onHowToFinish}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="help-circle" size={15} color={palette.muted} style={{ marginRight: 6 }} />
          <Text style={{ fontFamily: 'Inter_600SemiBold', color: palette.muted, fontSize: 13.5 }}>
            nasıl bitirilir?
          </Text>
        </Pressable>
        <View style={{ width: 1, height: 14, backgroundColor: palette.border, marginHorizontal: 16 }} />
        <Pressable
          onPress={async () => {
            await hx.tap();
            router.push('/support');
          }}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="phone" size={14} color={palette.muted} style={{ marginRight: 6 }} />
          <Text style={{ fontFamily: 'Inter_600SemiBold', color: palette.muted, fontSize: 13.5 }}>
            destek
          </Text>
        </Pressable>
      </View>

      </ScrollView>

      {/* Pinned bottom actions — always visible, so you never have to scroll to
          reach "seansı bitir". */}
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: insets.bottom + 8 }}>
        {/* Re-open the door — available anytime during the session. Volt primary. */}
        <View style={{ marginBottom: 10 }}>
          <Button
            label={reopening ? 'açılıyor…' : doorOpen ? 'kapı açık' : 'kapıyı aç'}
            onPress={onReopen}
            disabled={reopening || doorOpen}
            full
          />
        </View>

        {/* Primary CTA — coral-outline "seansı bitir". */}
        <Button variant="danger" label="seansı bitir" onPress={onFinishSession} />

        {/* Report-a-problem — subtle link under the CTA. */}
        <Pressable
          onPress={async () => {
            await hx.tap();
            setReportOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('gear.report.title')}
          hitSlop={8}
          style={{ marginTop: 12, alignSelf: 'center' }}
        >
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              color: palette.muted,
              fontSize: 13,
              textDecorationLine: 'underline',
            }}
          >
            {t('gear.report.title')}
          </Text>
        </Pressable>
      </View>

      {/* Overrun heads-up — one-time modal on arrival when time's already up. */}
      <Modal
        visible={overrunModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOverrunModalOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: '#00000088',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <View
            style={{
              backgroundColor: palette.surface,
              borderRadius: 24,
              padding: 24,
              width: '100%',
              maxWidth: 380,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: palette.danger + '1f',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Feather name="alert-triangle" size={26} color={palette.danger} />
            </View>
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 20,
                textAlign: 'center',
              }}
            >
              planlanan süre doldu
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_500Medium',
                color: palette.ink + 'aa',
                fontSize: 15,
                lineHeight: 22,
                textAlign: 'center',
                marginTop: 10,
              }}
            >
              {demoMode
                ? 'demo seansı ücretsiz — dilediğinde bitirebilirsin.'
                : 'her ek dakika için ücretlendirileceksin. bitirmek için kapıyı kapat & seansı bitir.'}
            </Text>
            <View style={{ marginTop: 20, width: '100%' }}>
              <Button
                label="anladım"
                onPress={async () => {
                  await hx.tap();
                  setOverrunModalOpen(false);
                }}
                full
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* End-session confirmation modal — phase-aware sheet that walks the
          user through "open the door → put gear back → close it". */}
      <EndSessionModal
        visible={endModalOpen}
        phase={returnPhase}
        onCancel={() => {
          // 'howto' is a pure info sheet — always dismissable; reset the phase
          // so the next REAL end-session opens on 'confirm', not 'howto'.
          if (returnPhase === 'howto') {
            setEndModalOpen(false);
            setReturnPhase('confirm');
            return;
          }
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
        accruedTry={demoMode ? 0 : costForMs(Date.now() - active.startedAt)}
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
                  backgroundColor: palette.surface,
                  borderWidth: 1.5,
                  borderColor: palette.border,
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
  phase: 'howto' | 'confirm' | 'opening' | 'awaiting_close';
  onCancel: () => void;
  onConfirmOpen: () => void | Promise<void>;
  onManualConfirmClosed: () => void | Promise<void>;
  onAddClosingPhoto: () => void | Promise<void>;
  photoState: 'idle' | 'busy' | 'saved' | 'failed';
  accruedTry: number;
}) {
  const dismissable = phase === 'confirm' || phase === 'howto';

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
            backgroundColor: palette.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: palette.border,
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
              backgroundColor: palette.border,
              marginBottom: 18,
              opacity: dismissable ? 1 : 0.3,
            }}
          />

          {phase === 'howto' ? (
            <HowtoPhase onClose={onCancel} />
          ) : phase === 'confirm' ? (
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

// Informational sheet reached from "nasıl bitirilir?" — the SAME StepRail the
// real return flow shows, but read-only: no BLE, no door action, just a plain
// "anladım" that closes. Mirrors the kapı-steps redesign.
function HowtoPhase({ onClose }: { onClose: () => void }) {
  const steps: StepRailStep[] = [
    { text: 'kapıyı açacağız', sub: 'kutunun kapağı açılır' },
    { text: 'ekipmanı yerine koy', sub: 'aldığın yuvaya' },
    { text: 'kapıyı kapat', sub: 'kapanınca kilitlenir' },
  ];

  return (
    <>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: palette.volt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Feather name="help-circle" size={30} color={palette.voltInk} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.fg,
          fontSize: 28,
          lineHeight: 33,
          textTransform: 'uppercase',
        }}
      >
        nasıl bitirilir?
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          color: palette.muted,
          fontSize: 15,
          lineHeight: 21,
          marginTop: 8,
        }}
      >
        seansı bitirmek için kutunun yanına gel ve sırasıyla:
      </Text>

      <View style={{ marginTop: 18 }}>
        <StepRail steps={steps} />
      </View>

      <Pressable
        onPress={async () => {
          await hx.tap();
          onClose();
        }}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: 22,
          backgroundColor: palette.volt,
          borderRadius: 16,
          paddingVertical: 16,
          alignItems: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.voltInk,
            fontSize: 16,
            textTransform: 'uppercase',
          }}
        >
          anladım
        </Text>
      </Pressable>
    </>
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
  const steps: StepRailStep[] = [
    { text: 'kapıyı açacağız', sub: 'kutunun kapağı açılır' },
    { text: 'ekipmanı yerine koy', sub: 'aldığın yuvaya' },
    { text: 'kapıyı kapat', sub: 'kapanınca kilitlenir' },
  ];

  return (
    <>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: palette.volt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Feather name="rotate-ccw" size={30} color={palette.voltInk} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.fg,
          fontSize: 28,
          lineHeight: 33,
          textTransform: 'uppercase',
        }}
      >
        iade edelim mi?
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          color: palette.muted,
          fontSize: 15,
          lineHeight: 21,
          marginTop: 8,
        }}
      >
        kapıyı şimdi açacağız. sırasıyla şu adımları yap:
      </Text>

      <View style={{ marginTop: 18 }}>
        <StepRail steps={steps} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        }}
      >
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.muted,
            fontSize: 13,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          şu ana kadar
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_700Bold',
            color: palette.voltText,
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
            backgroundColor: palette.volt,
            borderRadius: 999,
            paddingVertical: 18,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            shadowColor: palette.volt,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          <Feather
            name="unlock"
            size={20}
            color={palette.voltInk}
            style={{ marginRight: 10 }}
          />
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.voltInk,
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
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.fg,
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
          backgroundColor: palette.volt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Feather name="unlock" size={30} color={palette.voltInk} />
      </View>
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.fg,
          fontSize: 24,
          lineHeight: 28,
          textAlign: 'center',
          textTransform: 'uppercase',
        }}
      >
        kapı açılıyor...
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          color: palette.muted,
          fontSize: 14,
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
          backgroundColor: palette.volt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Feather name="check" size={30} color={palette.voltInk} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.fg,
          fontSize: 28,
          lineHeight: 33,
          textTransform: 'uppercase',
        }}
      >
        kapı açık
      </Text>
      <Text
        style={{
          fontFamily: 'Inter_500Medium',
          color: palette.muted,
          fontSize: 15,
          lineHeight: 21,
          marginTop: 8,
        }}
      >
        son üç adım — sırasıyla yap, sonra bitir.
      </Text>

      {/* Return steps — calm, evenly-spaced numbered list. The closing photo
          is step 3 and is REQUIRED to finish (gating handled on the CTA). */}
      <View style={{ marginTop: 18 }}>
        <StepRail
          steps={[
            { text: 'ekipmanı kutuya geri koy', sub: 'açık yuvaya' },
            { text: 'kapıyı kapat', sub: 'kapanınca kilitlenir' },
            {
              text: 'kapanış fotoğrafı çek',
              sub: 'iadeyi onaylamak için',
              done: photoState === 'saved' || photoState === 'failed',
            },
          ]}
        />
      </View>

      {/* Price — given its own breathing room and clear label so the amount
          reads cleanly instead of competing with the surrounding copy. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 18,
          paddingTop: 16,
          borderTopWidth: 1,
          borderTopColor: palette.border,
        }}
      >
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.muted,
            fontSize: 12,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          toplam tutar
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_700Bold',
            color: palette.voltText,
            fontSize: 30,
            letterSpacing: 0.2,
          }}
        >
          {formatTry(accruedTry)}
        </Text>
      </View>

      {/* Single adaptive primary action — NEVER a dead tap. The closing photo
          is mandatory, so until one has been captured this button opens the
          camera ("kapanış fotoğrafı çek"); the camera also auto-opens on entry.
          Once an upload has been attempted (saved OR failed — a network failure
          must never trap the user) it becomes the finish button. */}
      {(() => {
        const photoSatisfied =
          !ImagePicker || photoState === 'saved' || photoState === 'failed';
        const busy = photoState === 'busy';
        const onPress = busy
          ? undefined
          : photoSatisfied
          ? onManualConfirmClosed
          : onAddClosingPhoto;
        const label = busy
          ? 'fotoğraf yükleniyor...'
          : photoSatisfied
          ? 'kapattım, bitir'
          : 'kapanış fotoğrafı çek';
        const bg = palette.volt;
        return (
          <Pressable
            onPress={onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={label}
            style={({ pressed }) => ({
              marginTop: 18,
              opacity: busy ? 0.6 : pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                backgroundColor: bg,
                borderRadius: 999,
                paddingVertical: 18,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                shadowColor: bg,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: busy ? 0 : 0.25,
                shadowRadius: 14,
                elevation: busy ? 0 : 8,
              }}
            >
              <Feather
                name={photoSatisfied ? 'check' : 'camera'}
                size={20}
                color={palette.voltInk}
                style={{ marginRight: 10 }}
              />
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.voltInk,
                  fontSize: 17,
                  letterSpacing: 0.4,
                }}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })()}

      {/* Status sub-line — always tells the user where they stand. */}
      {ImagePicker && photoState === 'idle' ? (
        <Text
          style={{
            marginTop: 10,
            fontFamily: 'Inter_500Medium',
            color: palette.muted,
            fontSize: 12,
            textAlign: 'center',
            lineHeight: 17,
          }}
        >
          bitirmek için kapanış fotoğrafı gerekiyor — kamera otomatik açılır.
        </Text>
      ) : null}
      {photoState === 'saved' ? (
        <Text
          style={{
            marginTop: 10,
            fontFamily: 'Inter_500Medium',
            color: palette.muted,
            fontSize: 12,
            textAlign: 'center',
            lineHeight: 17,
          }}
        >
          ✓ kapanış fotoğrafı eklendi
        </Text>
      ) : null}
      {/* No failure surface: the upload is fire-and-forget in the background
          (audit-only), so a failed upload is logged, never shown. The photo is
          marked "eklendi" the moment it's captured. */}
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
  const accent = palette.danger;
  const borderTint = tone === 'alert' ? palette.danger + '66' : palette.border;
  const onBody = palette.fg;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: tone === 'alert' ? palette.danger + '1f' : palette.surfaceAlt,
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
        <Feather name={icon} size={16} color={palette.fg} />
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
            fontFamily: 'Inter_500Medium',
            color: palette.muted,
            fontSize: 13,
            lineHeight: 18,
            marginTop: 4,
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
              backgroundColor: palette.volt,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
            }}
          >
            <Feather
              name="message-circle"
              size={12}
              color={palette.voltInk}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.voltInk,
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
