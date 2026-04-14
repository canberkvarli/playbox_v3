import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { PROVIDER_DEFAULT, Marker, Region } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS, SPORT_LABELS, CITY_LABELS, type Sport, type Station } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useMapStore } from '@/stores/mapStore';
import { haversineKm, walkingMinutes } from '@/lib/geo';

const FALLBACK_REGION: Region = {
  latitude: 41.0370, // Taksim
  longitude: 28.9850,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

const FILTERS: Array<Sport | 'all'> = ['all', 'football', 'basketball', 'volleyball', 'paddle', 'tennis'];

function StationMarkerView({ station, index }: { station: Station; index: number }) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      index * 40,
      withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) })
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.6 + 0.4 * enter.value }],
  }));

  const primarySport = station.sports[0];

  return (
    <Animated.View
      style={[
        {
          backgroundColor: palette.butter,
          borderRadius: 14,
          width: 38,
          height: 38,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: palette.ink,
          shadowColor: palette.ink,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.18,
          shadowRadius: 4,
          elevation: 4,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 18 }}>{SPORT_EMOJI[primarySport]}</Text>
      {station.availableNow && (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: palette.coral,
            borderWidth: 1.5,
            borderColor: palette.paper,
          }}
        />
      )}
    </Animated.View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? palette.ink : palette.paper,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: active ? palette.ink : palette.ink + '33',
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text
        className={active ? 'text-paper font-medium' : 'text-ink font-medium'}
        style={{ fontSize: 14 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function Map() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const { filter, selectedStationId, setFilter, selectStation } = useMapStore();

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<keyof typeof CITY_LABELS>('istanbul');

  // Filter stations by sport
  const visibleStations = useMemo(
    () => (filter === 'all' ? STATIONS : STATIONS.filter((s) => s.sports.includes(filter as Sport))),
    [filter]
  );

  const cityActiveCount = useMemo(
    () => visibleStations.filter((s) => s.city === city && s.availableNow).length,
    [visibleStations, city]
  );

  const selectedStation = useMemo(
    () => STATIONS.find((s) => s.id === selectedStationId) ?? null,
    [selectedStationId]
  );

  // Resolve user location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // Task 13 already prompts during onboarding — don't re-prompt here.
          return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(next);

        // Pick city based on closest centroid
        const centroids: Record<keyof typeof CITY_LABELS, { lat: number; lng: number }> = {
          istanbul: { lat: 41.0082, lng: 28.9784 },
          ankara:   { lat: 39.9334, lng: 32.8597 },
          izmir:    { lat: 38.4237, lng: 27.1428 },
        };
        let best: keyof typeof CITY_LABELS = 'istanbul';
        let bestDist = Infinity;
        for (const k of Object.keys(centroids) as Array<keyof typeof CITY_LABELS>) {
          const d = haversineKm(next, centroids[k]);
          if (d < bestDist) {
            bestDist = d;
            best = k;
          }
        }
        setCity(best);

        // Animate camera
        mapRef.current?.animateToRegion(
          {
            latitude: next.lat,
            longitude: next.lng,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          },
          900
        );
      } catch {
        // silent — fall back to FALLBACK_REGION
      }
    })();
  }, []);

  const onMarkerPress = async (station: Station) => {
    await hx.tap();
    selectStation(station.id);
    sheetRef.current?.expand();
  };

  const onFilterPress = async (f: Sport | 'all') => {
    await hx.tap();
    setFilter(f);
  };

  const onSheetClose = () => {
    selectStation(null);
  };

  const distanceKm = useMemo(() => {
    if (!userLoc || !selectedStation) return null;
    return haversineKm(userLoc, { lat: selectedStation.lat, lng: selectedStation.lng });
  }, [userLoc, selectedStation]);

  return (
    <View className="flex-1 bg-paper">
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={FALLBACK_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        showsCompass={false}
        showsScale={false}
      >
        {visibleStations.map((s, i) => (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            onPress={() => onMarkerPress(s)}
            tracksViewChanges={false}
          >
            <StationMarkerView station={s} index={i} />
          </Marker>
        ))}
      </MapView>

      {/* Top city pill */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: insets.top + 12,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <BlurView
          intensity={40}
          tint="light"
          style={{
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 10,
            overflow: 'hidden',
            backgroundColor: palette.paper + 'cc',
            borderWidth: 1,
            borderColor: palette.ink + '14',
          }}
        >
          <Text className="font-medium text-ink text-sm">
            {t('map.city_count', { city: CITY_LABELS[city], count: cityActiveCount })}
          </Text>
        </BlurView>
      </View>

      {/* Bottom filter chips */}
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 12,
          left: 0,
          right: 0,
        }}
        pointerEvents="box-none"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {FILTERS.map((f) => (
            <FilterChip
              key={f}
              active={filter === f}
              label={t(`map.filters.${f}`)}
              onPress={() => onFilterPress(f)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Bottom sheet station preview */}
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={[260]}
        enablePanDownToClose
        onClose={onSheetClose}
        backgroundStyle={{ backgroundColor: palette.paper }}
        handleIndicatorStyle={{ backgroundColor: palette.ink + '44' }}
      >
        <BottomSheetView style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 }}>
          {selectedStation ? (
            <>
              <Text className="font-display-x text-ink text-3xl" style={{ lineHeight: 30 }}>
                {selectedStation.name}
              </Text>
              <Text className="font-sans text-ink/60 text-sm mt-1">
                {distanceKm !== null
                  ? t('map.preview.walking_time', { min: walkingMinutes(distanceKm) })
                  : t('map.no_location')}
              </Text>

              <View className="flex-row flex-wrap gap-2 mt-4">
                {selectedStation.sports.map((sport) => {
                  const stock = selectedStation.stock[sport] ?? 0;
                  const out = stock === 0;
                  return (
                    <View
                      key={sport}
                      style={{
                        backgroundColor: out ? palette.ink + '14' : palette.butter,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{SPORT_EMOJI[sport]}</Text>
                      <Text className={out ? 'font-sans text-ink/40 text-sm' : 'font-medium text-ink text-sm'}>
                        {SPORT_LABELS[sport]} · {stock}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <Pressable
                onPress={async () => {
                  await hx.press();
                }}
                disabled={!selectedStation.availableNow}
                style={({ pressed }) => ({
                  backgroundColor: selectedStation.availableNow ? palette.coral : palette.ink + '33',
                  borderRadius: 16,
                  paddingVertical: 16,
                  marginTop: 16,
                  transform: [{ scale: pressed && selectedStation.availableNow ? 0.98 : 1 }],
                })}
              >
                <Text
                  className={selectedStation.availableNow ? 'text-paper font-semibold text-base text-center' : 'text-ink/50 font-semibold text-base text-center'}
                >
                  {selectedStation.availableNow
                    ? t('map.preview.open')
                    : t('map.preview.out_of_stock')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}
