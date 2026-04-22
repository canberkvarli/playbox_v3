import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS, type Station, type Sport } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useSessionStore } from '@/stores/sessionStore';
import { StationGateSelector } from '@/components/StationGateSelector';

export default function StationDetail() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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
        className="flex-1 bg-paper dark:bg-ink items-center justify-center px-6"
        style={{ paddingTop: insets.top }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 16, left: 16 }}
        >
          <Feather name="x" size={24} color={theme.fg} />
        </Pressable>
        <Text className="font-display-x text-ink dark:text-paper text-3xl text-center">
          {t('station.not_found')}
        </Text>
        <Text className="font-sans text-ink/60 dark:text-paper/60 text-center mt-3">
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

  const onUnlock = async (sport: Sport, _durationMinutes: number) => {
    // Route to the "how it works" prep slides; the last slide starts the session.
    router.push({
      pathname: '/session-prep/[stationId]/[sport]',
      params: { stationId: station.id, sport },
    });
  };

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
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
            backgroundColor: theme.bg,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: theme.fg + '1a',
          }}
        >
          <Feather name="arrow-left" size={22} color={theme.fg} />
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
          className="font-display-x text-ink dark:text-paper"
          style={{ fontSize: 44, lineHeight: 46, letterSpacing: 0.2 }}
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
          <View className="flex-row items-center gap-2">
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: station.availableNow ? '#3aaf6a' : palette.coral,
              }}
            />
            <Text className="font-mono text-ink/70 dark:text-paper/70 text-sm">
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
              backgroundColor: theme.fg + '0d',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="navigation" size={14} color={theme.fg} />
            <Text
              style={{
                fontSize: 12,
                color: theme.fg,
                fontWeight: '600',
                letterSpacing: 0.2,
              }}
            >
              {t('station.directions')}
            </Text>
          </Pressable>
        </View>

        <View className="mt-10">
          <StationGateSelector
            station={station}
            onUnlock={onUnlock}
            unlocking={unlocking}
          />
        </View>
      </ScrollView>
    </View>
  );
}
