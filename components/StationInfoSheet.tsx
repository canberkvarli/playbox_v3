import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { type Station } from '@/data/stations.seed';

export type StationInfoSheetHandle = {
  open: (s: Station) => void;
  close: () => void;
};

export const StationInfoSheet = forwardRef<StationInfoSheetHandle, object>(
  function StationInfoSheet(_, ref) {
    const sheetRef = useRef<BottomSheet>(null);
    const [station, setStation] = useState<Station | null>(null);
    const { t } = useT();

    useImperativeHandle(ref, () => ({
      open: (s) => {
        setStation(s);
        sheetRef.current?.snapToIndex(0);
      },
      close: () => sheetRef.current?.close(),
    }));

    const onDirections = async () => {
      if (!station) return;
      await hx.tap();
      const url = Platform.select({
        ios: `maps:0,0?q=${encodeURIComponent(station.name)}@${station.lat},${station.lng}`,
        android: `geo:${station.lat},${station.lng}?q=${station.lat},${station.lng}(${encodeURIComponent(
          station.name
        )})`,
      });
      if (url) Linking.openURL(url).catch(() => {});
    };

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['52%']}
        enablePanDownToClose
        onClose={() => setStation(null)}
        backgroundStyle={{
          backgroundColor: palette.paper,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
        handleIndicatorStyle={{ backgroundColor: palette.ink + '33', width: 40 }}
      >
        <BottomSheetView style={{ paddingHorizontal: 24, paddingBottom: 24 }}>
          {station ? (
            <>
              {/* Photo placeholder — swap for real image when storage ships */}
              <View
                style={{
                  height: 160,
                  backgroundColor: palette.butter,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <Feather name="image" size={36} color={palette.ink + '55'} />
              </View>

              <Text
                className="font-display-x text-ink dark:text-paper text-3xl mt-5"
                style={{ lineHeight: 34 }}
              >
                {station.name}
              </Text>

              <View className="flex-row items-center gap-2 mt-3">
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: station.availableNow
                      ? palette.coral
                      : palette.ink + '44',
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
                style={({ pressed }) => ({
                  backgroundColor: palette.coral,
                  borderRadius: 16,
                  paddingVertical: 14,
                  marginTop: 22,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Feather name="navigation" size={18} color={palette.paper} />
                <Text className="font-semibold text-paper text-base">
                  {t('station.directions')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </BottomSheetView>
      </BottomSheet>
    );
  }
);
