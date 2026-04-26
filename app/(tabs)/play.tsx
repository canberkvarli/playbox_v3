import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
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

  const [endModalOpen, setEndModalOpen] = useState(false);

  const onFinishSession = async () => {
    await hx.punch();
    setEndModalOpen(true);
  };

  const onConfirmEnd = async () => {
    await hx.yes();
    setEndModalOpen(false);
    if (fakeActiveSession) setFakeActiveSession(false);
    endSession();
    router.replace('/session-review');
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

      {/* Station card */}
      <View
        style={{
          marginTop: 16,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: palette.butter,
          borderRadius: 22,
          paddingVertical: 16,
          paddingHorizontal: 18,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: palette.paper,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: palette.ink + '14',
            marginRight: 14,
          }}
        >
          <Text style={{ fontSize: 26 }}>{SPORT_EMOJI[active.sport]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 19,
              lineHeight: 23,
            }}
          >
            {active.stationName}
          </Text>
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 12,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginTop: 5,
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

      {/* End-session confirmation modal — replaces the OS alert with
          a branded sheet that mirrors the rest of the app. */}
      <EndSessionModal
        visible={endModalOpen}
        onCancel={() => setEndModalOpen(false)}
        onConfirm={onConfirmEnd}
        accruedTry={costForMs(Date.now() - active.startedAt)}
      />

      {__DEV__ ? (
        <Pressable
          onPress={async () => {
            await hx.tap();
            setFakeActiveSession(!fakeActiveSession);
          }}
          style={{ marginTop: 12 }}
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
      ) : null}
    </View>
  );
}

/**
 * End-session confirmation. Branded modal that mimics a bottom sheet —
 * paper bg, big ink title, a yellow "checklist" summary so the user is
 * reminded what they're confirming, and two clear CTAs.
 */
function EndSessionModal({
  visible,
  onCancel,
  onConfirm,
  accruedTry,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  accruedTry: number;
}) {
  // Three required confirmations before the user can end. State resets each
  // time the modal opens so they can't carry stale checks across attempts.
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  useEffect(() => {
    if (visible) setChecks([false, false, false]);
  }, [visible]);

  const allChecked = checks.every(Boolean);
  const items = ['ekipman istasyonda', 'kapı kapalı', 'aldığım parça eksiksiz'];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        onPress={onCancel}
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
          {/* Drag handle */}
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: palette.ink + '22',
              marginBottom: 18,
            }}
          />

          {/* Hero icon */}
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
            seansı bitir?
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
            her birini onayla. eksik onay olursa kapatma kaydedilmez.
          </Text>

          {/* Tappable checklist — must all be checked before evet kapattım enables */}
          <View style={{ marginTop: 18 }}>
            {items.map((line, idx) => {
              const checked = checks[idx];
              return (
                <Pressable
                  key={line}
                  onPress={async () => {
                    await hx.tap();
                    setChecks((prev) => {
                      const next = [...prev];
                      next[idx] = !next[idx];
                      return next;
                    });
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  style={({ pressed }) => ({
                    marginBottom: 10,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: checked ? palette.ink : palette.butter,
                      borderRadius: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                      borderWidth: 1.5,
                      borderColor: checked ? palette.ink : palette.ink + '14',
                    }}
                  >
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        backgroundColor: checked ? palette.coral : 'transparent',
                        borderWidth: 2,
                        borderColor: checked ? palette.coral : palette.ink + '55',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                      }}
                    >
                      {checked ? (
                        <Feather name="check" size={16} color={palette.paper} />
                      ) : null}
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: 'Unbounded_700Bold',
                        color: checked ? palette.paper : palette.ink,
                        fontSize: 14,
                        letterSpacing: 0.2,
                      }}
                    >
                      {line}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Cost line */}
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

          {/* Primary CTA — gated until all 3 are checked */}
          <Pressable
            onPress={allChecked ? onConfirm : undefined}
            disabled={!allChecked}
            accessibilityRole="button"
            accessibilityLabel="evet, kapattım"
            style={({ pressed }) => ({
              marginTop: 22,
              opacity: !allChecked ? 0.45 : pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                backgroundColor: allChecked ? palette.coral : palette.ink + '33',
                borderRadius: 18,
                paddingVertical: 18,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                shadowColor: palette.coral,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: allChecked ? 0.3 : 0,
                shadowRadius: 16,
                elevation: allChecked ? 10 : 0,
              }}
            >
              <Feather name="check" size={20} color={palette.paper} style={{ marginRight: 10 }} />
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 17,
                  letterSpacing: 0.4,
                }}
              >
                evet, kapattım
              </Text>
            </View>
          </Pressable>

          {/* Secondary action — outlined ink pill, sits well below the
              primary so the two CTAs can't visually overlap. */}
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="henüz değil"
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
                henüz değil
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
