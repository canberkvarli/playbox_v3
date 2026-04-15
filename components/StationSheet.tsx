import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Pressable, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import type { Station, Sport } from '@/data/stations.seed';
import { useSessionStore } from '@/stores/sessionStore';
import { StationDetailPanel } from './StationDetailPanel';
import { StationTourSheet, type StationTourSheetHandle } from './StationTourSheet';
import { hasSeenTour, markTourSeen } from '@/lib/seenTour';

export type StationSheetHandle = {
  open: (s: Station) => void;
  close: () => void;
};

/**
 * Bottom-sheet host for station detail. Mounts StationDetailPanel inside
 * a BottomSheetScrollView at a 92% snap point. Also mounts StationTourSheet
 * so the first-time tour overlays the station sheet properly.
 */
export const StationSheet = forwardRef<StationSheetHandle>(function StationSheet(_, ref) {
  const sheetRef = useRef<BottomSheet>(null);
  const tourRef = useRef<StationTourSheetHandle>(null);
  const [station, setStation] = useState<Station | null>(null);
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const startSession = useSessionStore((s) => s.startSession);

  useImperativeHandle(ref, () => ({
    open: (s) => {
      setStation(s);
      sheetRef.current?.snapToIndex(0);
      hasSeenTour().then((seen) => {
        if (!seen) setTimeout(() => tourRef.current?.open(), 500);
      });
    },
    close: () => sheetRef.current?.close(),
  }));

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.4}
        pressBehavior="close"
      />
    ),
    []
  );

  const onUnlock = async (sport: Sport) => {
    if (!station) return;
    await hx.punch();
    startSession({
      stationId: station.id,
      stationName: station.name,
      sport,
      durationMinutes: 30,
    });
    sheetRef.current?.close();
    router.replace('/(tabs)/play');
  };

  const onHelp = async () => {
    await hx.tap();
    tourRef.current?.open();
  };

  const onClose = async () => {
    await hx.tap();
    sheetRef.current?.close();
  };

  const headerSlot = (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 4,
      }}
    >
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.fg + '0d',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="x" size={20} color={theme.fg} />
      </Pressable>
      <Pressable
        onPress={onHelp}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Help"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.fg + '0d',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="help-circle" size={20} color={theme.fg} />
      </Pressable>
    </View>
  );

  return (
    <>
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['92%']}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.bg }}
        handleIndicatorStyle={{ backgroundColor: theme.fg + '44', width: 40, height: 4 }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {station ? (
            <StationDetailPanel
              station={station}
              onUnlock={onUnlock}
              headerSlot={headerSlot}
            />
          ) : null}
        </BottomSheetScrollView>
      </BottomSheet>

      <StationTourSheet
        ref={tourRef}
        onDismiss={() => {
          markTourSeen();
        }}
      />
    </>
  );
});
