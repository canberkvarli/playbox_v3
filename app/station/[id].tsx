import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { STATIONS, type Station, type Sport } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { StationDetailPanel } from '@/components/StationDetailPanel';
import {
  StationTourSheet,
  type StationTourSheetHandle,
} from '@/components/StationTourSheet';
import { markTourSeen } from '@/lib/seenTour';

/**
 * Standalone /station/[id] route — kept functional for deep links.
 * Reuses StationDetailPanel. The primary station-detail surface is now the
 * bottom sheet mounted in the map tab (components/StationSheet.tsx).
 */
export default function StationDetail() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const lastSelected = useMapStore((s) => s.lastSelectedStation);

  const tourRef = useRef<StationTourSheetHandle>(null);

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

  const onHelp = async () => {
    await hx.tap();
    tourRef.current?.open();
  };

  const onSportTap = async (sport: Sport) => {
    await hx.tap();
    router.push({
      pathname: '/session-prep/[stationId]/[sport]',
      params: { stationId: station.id, sport },
    });
  };

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
      {/* Back arrow — top-left overlay */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.bg,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.fg + '1a',
          }}
        >
          <Feather name="arrow-left" size={20} color={theme.fg} />
        </Pressable>
      </View>

      {/* Help (?) — top-right overlay */}
      <Pressable
        onPress={onHelp}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common.help')}
        style={{
          position: 'absolute',
          top: insets.top + 12,
          right: 16,
          zIndex: 10,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: theme.fg + '1a',
        }}
      >
        <Feather name="help-circle" size={20} color={theme.fg} />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 72,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <StationDetailPanel station={station} onSportTap={onSportTap} />
      </ScrollView>

      <StationTourSheet ref={tourRef} onDismiss={() => markTourSeen()} />
    </View>
  );
}
