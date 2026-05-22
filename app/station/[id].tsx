import { useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS, type Station, type Sport } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useSessionStore } from '@/stores/sessionStore';
import { StationGateSelector } from '@/components/StationGateSelector';
import { useGuardedPress } from '@/hooks/useGuardedPress';
import { stationClient } from '@/lib/ble/stationClient';
import { fetchSignedUnlock, fetchSignedReturnUnlock } from '@/lib/ble/signUnlock';

export default function StationDetail() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);
  const startSession = useSessionStore((s) => s.startSession);

  const [unlocking, setUnlocking] = useState(false);

  const station: Station | null = useMemo(() => {
    if (lastSelected && lastSelected.id === id) return lastSelected;
    return STATIONS.find((s) => s.id === id) ?? null;
  }, [id, lastSelected]);

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
        >
          <Feather name="x" size={24} color={palette.ink} />
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 28,
            lineHeight: 32,
            textAlign: 'center',
          }}
        >
          {t('station.not_found')}
        </Text>
        <Text
          style={{
            color: palette.ink + '99',
            textAlign: 'center',
            marginTop: 12,
            fontSize: 15,
          }}
        >
          {t('station.not_found_sub')}
        </Text>
      </View>
    );
  }

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onDirections = async () => {
    await hx.tap();
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(station.name)}@${station.lat},${station.lng}`,
      android: `geo:${station.lat},${station.lng}?q=${station.lat},${station.lng}(${encodeURIComponent(
        station.name
      )})`,
    });
    if (url) Linking.openURL(url).catch(() => {});
  };

  const onUnlock = useGuardedPress(async (sport: Sport, _durationMinutes: number) => {
    // Route to the "how it works" prep slides; the last slide starts the session.
    router.push({
      pathname: '/session-prep/[stationId]/[sport]',
      params: { stationId: station.id, sport },
    });
  });

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Top chrome — back arrow only (info icon removed; directions inline below) */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: palette.paper,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: palette.ink + '1a',
          }}
        >
          <Feather name="arrow-left" size={22} color={palette.ink} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {/* Title block — name + status dot + hours + directions link */}
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 40,
            lineHeight: 44,
            letterSpacing: 0.2,
          }}
        >
          {station.name}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                marginRight: 8,
                backgroundColor: station.availableNow ? '#3aaf6a' : palette.coral,
              }}
            />
            <Text
              style={{
                color: palette.ink,
                fontSize: 13,
                fontFamily: 'Unbounded_700Bold',
                letterSpacing: 0.5,
              }}
            >
              {t(
                station.availableNow
                  ? 'station.status.open'
                  : 'station.status.closed'
              )}
              {' · 24/7'}
            </Text>
          </View>
          <Pressable
            onPress={onDirections}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: palette.ink + '0d',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="navigation" size={14} color={palette.ink} />
            <Text
              style={{
                fontSize: 13,
                color: palette.ink,
                fontFamily: 'Unbounded_700Bold',
                letterSpacing: 0.3,
              }}
            >
              {t('station.directions')}
            </Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 36 }}>
          <StationGateSelector
            station={station}
            onUnlock={onUnlock}
            unlocking={unlocking}
          />
        </View>

        {station.id === 'DEV-001' ? <DevServoButtons stationId={station.id} /> : null}
      </ScrollView>
    </View>
  );
}

// =============================================================================
// DevServoButtons — Phase 0 only.
// Two buttons that drive the breadboard servo directly without going through
// the reservation / payment-hold flow. The edge function only honors
// `dev_bypass` for station_id === 'DEV-001', so this is scoped to the dev unit.
// =============================================================================
function DevServoButtons({ stationId }: { stationId: string }) {
  const [busy, setBusy] = useState<null | 'unlock' | 'return'>(null);

  const runUnlock = async () => {
    if (busy) return;
    setBusy('unlock');
    try {
      const signed = await fetchSignedUnlock({
        stationId,
        gate: 1,
        sessionId: `dev-${Date.now()}`,
        durationMin: 30,
        devBypass: true,
      });
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      await stationClient.unlock(signed);
    } catch (e: unknown) {
      Alert.alert('Force Unlock failed', String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const runReturn = async () => {
    if (busy) return;
    setBusy('return');
    try {
      const signed = await fetchSignedReturnUnlock({
        stationId,
        gate: 1,
        sessionId: `dev-${Date.now()}`,
        devBypass: true,
      });
      if (!stationClient.isConnected()) {
        await stationClient.scanAndConnect(`Playbox-${stationId.toUpperCase()}`, 8000);
      }
      await stationClient.returnUnlock(signed);
    } catch (e: unknown) {
      Alert.alert('Force Return failed', String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View
      style={{
        marginTop: 28,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: palette.ink + '22',
        backgroundColor: palette.ink + '06',
      }}
    >
      <Text
        style={{
          fontFamily: 'JetBrainsMono_700Bold',
          fontSize: 10,
          letterSpacing: 1.2,
          color: palette.ink + 'aa',
          marginBottom: 10,
        }}
      >
        DEV · SERVO TEST · BYPASSES PAYMENT
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={runUnlock}
          disabled={!!busy}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: palette.ink,
            opacity: busy === 'unlock' ? 0.5 : pressed ? 0.8 : 1,
            alignItems: 'center',
          })}
        >
          <Text style={{ color: palette.paper, fontFamily: 'Unbounded_700Bold', fontSize: 13 }}>
            {busy === 'unlock' ? 'unlocking…' : 'force unlock'}
          </Text>
        </Pressable>
        <Pressable
          onPress={runReturn}
          disabled={!!busy}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: palette.coral,
            opacity: busy === 'return' ? 0.5 : pressed ? 0.8 : 1,
            alignItems: 'center',
          })}
        >
          <Text style={{ color: palette.paper, fontFamily: 'Unbounded_700Bold', fontSize: 13 }}>
            {busy === 'return' ? 'returning…' : 'force return'}
          </Text>
        </Pressable>
      </View>
      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 11,
          color: palette.ink + '88',
          marginTop: 8,
          lineHeight: 16,
        }}
      >
        Force Unlock → servo to 90° (state: UNLOCKED). Press BOOT button on ESP32 to advance to IN_USE.
        Force Return → servo to 90° (state: RETURN_UNLOCKED). Press BOOT to close, fires gate_closed.
      </Text>
    </View>
  );
}
