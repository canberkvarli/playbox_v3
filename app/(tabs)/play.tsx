import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useSessionStore, type ActiveSession } from '@/stores/sessionStore';
import { useDevStore } from '@/stores/devStore';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
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

  return (
    <View
      style={{
        backgroundColor: palette.ink,
        borderRadius: 28,
        padding: 28,
        alignItems: 'center',
      }}
    >
      {/* Eyebrow */}
      <Text
        style={{
          fontFamily: 'JetBrainsMono_400Regular',
          color: palette.butter + 'cc',
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        aktif seans
      </Text>

      {/* Big timer */}
      <Text
        style={{
          fontFamily: 'JetBrainsMono_400Regular',
          color: palette.paper,
          fontSize: 72,
          lineHeight: 80,
          letterSpacing: 4,
          marginTop: 12,
          includeFontPadding: false,
        }}
      >
        {fmt(elapsed)}
      </Text>

      {/* Progress bar */}
      <View
        style={{
          width: '100%',
          height: 6,
          backgroundColor: palette.paper + '22',
          borderRadius: 3,
          marginTop: 20,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            backgroundColor: overtime ? palette.butter : palette.coral,
            borderRadius: 3,
          }}
        />
      </View>

      {/* Sport + station + planned */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: 16,
          width: '100%',
        }}
      >
        <Text style={{ fontSize: 22 }}>{SPORT_EMOJI[session.sport]}</Text>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.paper,
            fontSize: 16,
            lineHeight: 20,
          }}
        >
          {session.stationName}
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            color: palette.paper + '88',
            fontSize: 12,
          }}
        >
          {session.durationMinutes} dk
        </Text>
      </View>
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
      params: { stationId: active.stationId, sport: active.sport },
    });
  };

  const onFinishSession = async () => {
    await hx.punch();
    Alert.alert(
      'Topu iade ettin mi?',
      'Kapıyı kapat ve ekipmanı yerine bırak. Kapatmadıysan ek ücret alınabilir.',
      [
        { text: 'Henüz değil', style: 'cancel' },
        {
          text: 'Evet, kapattım',
          style: 'destructive',
          onPress: async () => {
            await hx.yes();
            if (fakeActiveSession) setFakeActiveSession(false);
            endSession();
            router.replace('/session-review');
          },
        },
      ]
    );
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
            fontSize: 24,
            textAlign: 'center',
            marginTop: 16,
          }}
        >
          aktif seans yok
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.ink + '88',
            fontSize: 14,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          haritadan bir istasyona git ve oyna
        </Text>
        <Pressable
          onPress={onGoMap}
          style={({ pressed }) => ({
            backgroundColor: palette.coral,
            borderRadius: 20,
            paddingVertical: 16,
            paddingHorizontal: 32,
            marginTop: 24,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
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
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
    >
      {/* Back to map */}
      <Pressable
        onPress={onGoMap}
        hitSlop={14}
        style={{ alignSelf: 'flex-start', marginBottom: 16, padding: 4 }}
      >
        <Feather name="chevron-left" size={28} color={palette.ink} />
      </Pressable>

      {/* Live timer card */}
      <LiveTimer session={active} />

      {/* How to finish — opens the prep slides */}
      <Pressable
        onPress={onHowToFinish}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginTop: 24,
          paddingVertical: 14,
          backgroundColor: palette.butter,
          borderRadius: 18,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Feather name="help-circle" size={18} color={palette.ink} />
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
          }}
        >
          nasıl bitirilir?
        </Text>
      </Pressable>

      <View style={{ flex: 1 }} />

      {/* Finish session CTA */}
      <Pressable
        onPress={onFinishSession}
        style={({ pressed }) => ({
          backgroundColor: palette.coral,
          borderRadius: 24,
          paddingVertical: 22,
          alignItems: 'center',
          shadowColor: palette.coral,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.3,
          shadowRadius: 14,
          elevation: 8,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.paper,
            fontSize: 22,
            letterSpacing: 1,
          }}
        >
          seansı bitir
        </Text>
      </Pressable>

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
