import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { PROVIDER_DEFAULT, Marker, Circle, Region } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';
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
import { clusterStations } from '@/lib/cluster';
import { stationsNearUser } from '@/lib/generateStations';

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
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.85 + 0.15 * enter.value }],
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

function ClusterMarker({ count, index }: { count: number; index: number }) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      index * 40,
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.85 + 0.15 * enter.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          backgroundColor: palette.butter,
          borderRadius: 22,
          minWidth: 44,
          height: 44,
          paddingHorizontal: 10,
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
      <Text className="font-display-x text-ink" style={{ fontSize: 18 }}>
        {count}
      </Text>
    </Animated.View>
  );
}

function NearMeSweep({ userLoc }: { userLoc: { lat: number; lng: number } | null }) {
  // Reanimated can't drive <Circle> props directly at this version. Use a state
  // driven pulse cycle that runs 3 times (~3s total) then unmounts.
  const [phase, setPhase] = useState(0); // 0..1 per 1000ms cycle
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!userLoc || done) return;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = (elapsed % 1000) / 1000;
      setPhase(p);
      if (elapsed >= 3000) {
        clearInterval(id);
        setDone(true);
        setPhase(0);
      }
    }, 33); // ~30fps
    return () => clearInterval(id);
  }, [userLoc, done]);

  if (!userLoc || done) return null;

  const radiusMeters = phase * 200;
  const opacity = 0.45 * (1 - phase);

  return (
    <Circle
      center={{ latitude: userLoc.lat, longitude: userLoc.lng }}
      radius={radiusMeters}
      strokeColor={palette.coral}
      strokeWidth={2}
      fillColor={`rgba(226, 105, 114, ${opacity * 0.15})`}
    />
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

function ViewToggle() {
  const insets = useSafeAreaInsets();
  const { viewMode, setViewMode } = useMapStore();

  const onToggle = async (mode: 'map' | 'list') => {
    if (mode === viewMode) return;
    await hx.tap();
    setViewMode(mode);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 12,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
      }}
    >
      <BlurView
        intensity={40}
        tint="light"
        style={{
          borderRadius: 999,
          overflow: 'hidden',
          backgroundColor: palette.paper + 'cc',
          borderWidth: 1,
          borderColor: palette.ink + '14',
          flexDirection: 'row',
          padding: 4,
          gap: 4,
        }}
      >
        <Pressable
          onPress={() => onToggle('map')}
          style={{
            backgroundColor: viewMode === 'map' ? palette.ink : 'transparent',
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 999,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Feather name="map" size={14} color={viewMode === 'map' ? palette.paper : palette.ink} />
          <Text
            className={viewMode === 'map' ? 'text-paper font-medium' : 'text-ink font-medium'}
            style={{ fontSize: 13 }}
          >
            harita
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggle('list')}
          style={{
            backgroundColor: viewMode === 'list' ? palette.ink : 'transparent',
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 999,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Feather name="list" size={14} color={viewMode === 'list' ? palette.paper : palette.ink} />
          <Text
            className={viewMode === 'list' ? 'text-paper font-medium' : 'text-ink font-medium'}
            style={{ fontSize: 13 }}
          >
            liste
          </Text>
        </Pressable>
      </BlurView>
    </View>
  );
}

function StationListView({
  stations,
  userLoc,
  onStationPress,
}: {
  stations: Station[];
  userLoc: { lat: number; lng: number } | null;
  onStationPress: (s: Station) => void;
}) {
  const { t } = useT();
  const insets = useSafeAreaInsets();

  const sorted = useMemo(() => {
    if (!userLoc) return stations;
    return [...stations].sort((a, b) => {
      const da = haversineKm(userLoc, { lat: a.lat, lng: a.lng });
      const db = haversineKm(userLoc, { lat: b.lat, lng: b.lng });
      return da - db;
    });
  }, [stations, userLoc]);

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: insets.top + 108, // toggle + city pill + breathing room
        paddingBottom: insets.bottom + 120,
        paddingHorizontal: 20,
        gap: 10,
      }}
      showsVerticalScrollIndicator={false}
    >
      {sorted.map((s) => {
        const km = userLoc ? haversineKm(userLoc, { lat: s.lat, lng: s.lng }) : null;
        return (
          <Pressable
            key={s.id}
            onPress={() => onStationPress(s)}
            style={({ pressed }) => ({
              backgroundColor: palette.paper,
              borderColor: palette.ink + '1a',
              borderWidth: 1,
              borderRadius: 20,
              padding: 16,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            })}
          >
            {km !== null && (
              <Text className="font-mono text-coral text-xs">
                {km < 10 ? km.toFixed(1) : km.toFixed(0)} km
              </Text>
            )}
            <Text className="font-display text-ink text-xl mt-1">{s.name}</Text>
            <View className="flex-row flex-wrap gap-2 mt-3">
              {s.sports.map((sport) => {
                const stock = s.stock[sport] ?? 0;
                const out = stock === 0;
                return (
                  <View
                    key={sport}
                    style={{
                      backgroundColor: out ? palette.ink + '14' : palette.butter,
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{SPORT_EMOJI[sport]}</Text>
                    <Text
                      className={
                        out ? 'font-sans text-ink/40 text-xs' : 'font-medium text-ink text-xs'
                      }
                    >
                      {SPORT_LABELS[sport]}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View
              style={{
                alignSelf: 'flex-start',
                marginTop: 12,
                backgroundColor: s.availableNow ? palette.coral : palette.ink + '22',
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text
                className={
                  s.availableNow
                    ? 'text-paper font-semibold text-xs'
                    : 'text-ink/50 font-semibold text-xs'
                }
              >
                {t('map.preview.open')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function Map() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const { filter, selectedStationId, viewMode, setFilter, selectStation, setViewMode } =
    useMapStore();

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<keyof typeof CITY_LABELS | 'generic'>('istanbul');
  const [latDelta, setLatDelta] = useState(FALLBACK_REGION.latitudeDelta);

  // Build the active station list from seed + generated demo stations near the user.
  const allStations = useMemo(
    () => stationsNearUser(userLoc, STATIONS, { minTotal: 12, radiusKm: 5 }),
    [userLoc]
  );

  // Filter stations by sport
  const visibleStations = useMemo(
    () =>
      filter === 'all'
        ? allStations
        : allStations.filter((s) => s.sports.includes(filter as Sport)),
    [filter, allStations]
  );

  const cityActiveCount = useMemo(
    () =>
      city === 'generic'
        ? visibleStations.filter((s) => s.availableNow).length
        : visibleStations.filter((s) => s.city === city && s.availableNow).length,
    [visibleStations, city]
  );

  const cityLabel = city === 'generic' ? t('map.generic_area') : CITY_LABELS[city];

  const selectedStation = useMemo(
    () => allStations.find((s) => s.id === selectedStationId) ?? null,
    [selectedStationId, allStations]
  );

  const clustered = useMemo(
    () => clusterStations(visibleStations, latDelta),
    [visibleStations, latDelta]
  );

  // Resolve user location
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // Onboarding usually prompts, but dev bypass / denial might skip it.
          // Re-request once here so the map can center on the user by default.
          const req = await Location.requestForegroundPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') return;

        const pos = await Location.getCurrentPositionAsync({});
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(next);

        // Pick city based on closest centroid
        const centroids: Record<keyof typeof CITY_LABELS, { lat: number; lng: number }> = {
          istanbul: { lat: 41.0082, lng: 28.9784 },
          ankara: { lat: 39.9334, lng: 32.8597 },
          izmir: { lat: 38.4237, lng: 27.1428 },
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
        // If the user is >200km from any Turkish city, show a generic label
        // instead of mislabeling them as "İstanbul".
        setCity(bestDist > 200 ? 'generic' : best);

        // Animate camera (tight enough that demo stations within 150m-2km are visible)
        mapRef.current?.animateToRegion(
          {
            latitude: next.lat,
            longitude: next.lng,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          900
        );
      } catch {
        // silent — fall back to FALLBACK_REGION
      }
    })();
  }, []);

  const onRegionChangeComplete = (region: Region) => {
    setLatDelta(region.latitudeDelta);
  };

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

  const onListStationPress = async (s: Station) => {
    await hx.tap();
    setViewMode('map');
    selectStation(s.id);
    // Next render has MapView mounted — recenter then open the sheet.
    requestAnimationFrame(() => {
      mapRef.current?.animateToRegion(
        {
          latitude: s.lat,
          longitude: s.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        500
      );
      setTimeout(() => sheetRef.current?.expand(), 600);
    });
  };

  const distanceKm = useMemo(() => {
    if (!userLoc || !selectedStation) return null;
    return haversineKm(userLoc, { lat: selectedStation.lat, lng: selectedStation.lng });
  }, [userLoc, selectedStation]);

  const FilterChipsBar = (
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
  );

  const CityPill = (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 60, // pushed below the view toggle
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
          {t('map.city_count', { city: cityLabel, count: cityActiveCount })}
        </Text>
      </BlurView>
    </View>
  );

  return (
    <View className="flex-1 bg-paper">
      {viewMode === 'map' ? (
        <>
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
            onRegionChangeComplete={onRegionChangeComplete}
          >
            <NearMeSweep userLoc={userLoc} />
            {clustered.map((item, i) => {
              if (item.type === 'cluster') {
                return (
                  <Marker
                    key={`${filter}-${item.data.id}`}
                    coordinate={{
                      latitude: item.data.lat,
                      longitude: item.data.lng,
                    }}
                    onPress={async () => {
                      await hx.tap();
                      mapRef.current?.animateToRegion(
                        {
                          latitude: item.data.lat,
                          longitude: item.data.lng,
                          latitudeDelta: latDelta * 0.3,
                          longitudeDelta: latDelta * 0.3,
                        },
                        600
                      );
                    }}
                    tracksViewChanges={false}
                  >
                    <ClusterMarker count={item.data.count} index={i} />
                  </Marker>
                );
              }
              return (
                <Marker
                  key={`${filter}-${item.data.id}`}
                  coordinate={{ latitude: item.data.lat, longitude: item.data.lng }}
                  onPress={() => onMarkerPress(item.data)}
                  tracksViewChanges={false}
                >
                  <StationMarkerView station={item.data} index={i} />
                </Marker>
              );
            })}
          </MapView>

          {CityPill}
          {FilterChipsBar}

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
                          <Text
                            className={
                              out
                                ? 'font-sans text-ink/40 text-sm'
                                : 'font-medium text-ink text-sm'
                            }
                          >
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
                      backgroundColor: selectedStation.availableNow
                        ? palette.coral
                        : palette.ink + '33',
                      borderRadius: 16,
                      paddingVertical: 16,
                      marginTop: 16,
                      transform: [{ scale: pressed && selectedStation.availableNow ? 0.98 : 1 }],
                    })}
                  >
                    <Text
                      className={
                        selectedStation.availableNow
                          ? 'text-paper font-semibold text-base text-center'
                          : 'text-ink/50 font-semibold text-base text-center'
                      }
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
        </>
      ) : (
        <>
          <StationListView
            stations={visibleStations}
            userLoc={userLoc}
            onStationPress={onListStationPress}
          />
          {CityPill}
          {FilterChipsBar}
        </>
      )}

      <ViewToggle />
    </View>
  );
}
