import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { PROVIDER_DEFAULT, Marker, Circle, Region } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS, SPORT_LABELS, CITY_LABELS, type Sport, type Station } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { useMapStore } from '@/stores/mapStore';
import { haversineKm } from '@/lib/geo';
import { clusterStations } from '@/lib/cluster';
import { stationsNearUser } from '@/lib/generateStations';

const FALLBACK_REGION: Region = {
  latitude: 41.0370, // Taksim
  longitude: 28.9850,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

const FILTERS: Array<Sport | 'all'> = ['all', 'football', 'basketball', 'volleyball', 'paddle', 'tennis'];

type SportCounts = Record<Sport | 'all', number>;

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
  const [phase, setPhase] = useState(0);
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
    }, 33);
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

function CommandBar() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const { viewMode, setViewMode, searchQuery, setSearchQuery } = useMapStore();
  const inputRef = useRef<TextInput>(null);

  const onModeChange = async (next: 'map' | 'list') => {
    if (next === viewMode) return;
    await hx.tap();
    setViewMode(next);
  };
  const onClear = async () => {
    await hx.tap();
    setSearchQuery('');
    Keyboard.dismiss();
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, zIndex: 10 }}
    >
      <BlurView
        intensity={60}
        tint={theme.isDark ? 'dark' : 'light'}
        style={{
          borderRadius: 28,
          overflow: 'hidden',
          backgroundColor: theme.bg + 'e6',
          borderWidth: 1,
          borderColor: theme.fg + '14',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 6,
          paddingVertical: 6,
          gap: 10,
          minHeight: 52,
        }}
      >
        <Feather name="search" size={18} color={theme.fg + '7f'} />
        <TextInput
          ref={inputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('map.search.placeholder')}
          placeholderTextColor={theme.fg + '66'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="flex-1 font-sans text-ink dark:text-paper text-base"
          style={{ paddingVertical: 0 }}
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={onClear} hitSlop={8}>
            <Feather name="x" size={16} color={theme.fg + '99'} />
          </Pressable>
        ) : null}
        <View style={{ width: 1, height: 22, backgroundColor: theme.fg + '1a' }} />
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {(['map', 'list'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => onModeChange(m)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: viewMode === m ? theme.fg : 'transparent',
              }}
            >
              <Feather
                name={m === 'map' ? 'map' : 'list'}
                size={15}
                color={viewMode === m ? theme.bg : theme.fg + '99'}
              />
            </Pressable>
          ))}
        </View>
      </BlurView>
    </View>
  );
}

function CityBadge({ cityLabel, count }: { cityLabel: string; count: number }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 76,
        left: 20,
        backgroundColor: theme.fg,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        zIndex: 8,
      }}
    >
      <Text
        style={{
          color: theme.bg,
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          letterSpacing: 0.3,
        }}
      >
        {cityLabel.toLowerCase()} · {count}
      </Text>
    </View>
  );
}

function SportChip({
  sport,
  active,
  count,
  onPress,
  label,
}: {
  sport: Sport | 'all';
  active: boolean;
  count: number;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  const scale = useSharedValue(active ? 1.04 : 1);

  useEffect(() => {
    scale.value = withSpring(active ? 1.04 : 1, { damping: 14, stiffness: 200 });
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const disabled = count === 0;
  const emoji = sport === 'all' ? '🎯' : SPORT_EMOJI[sport];

  const pill = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 6,
        borderRadius: 999,
        backgroundColor: active ? theme.butter : theme.bg + 'cc',
        borderWidth: 1,
        borderColor: active ? theme.fg + '1a' : theme.fg + '14',
        opacity: disabled ? 0.3 : 1,
        overflow: 'hidden',
      }}
    >
      <Text style={{ fontSize: 16, opacity: active ? 1 : 0.75 }}>{emoji}</Text>
      <Text
        style={{
          fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium',
          fontSize: 12,
          color: active ? palette.ink : theme.fg + 'cc',
          textTransform: 'lowercase',
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
      {!active && count > 0 ? (
        <Text
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            fontSize: 10,
            color: theme.fg + '7f',
          }}
        >
          · {count}
        </Text>
      ) : null}
      {active ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.coral,
            marginLeft: 2,
          }}
        />
      ) : null}
    </View>
  );

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active, disabled }}
      >
        {active ? (
          pill
        ) : (
          <BlurView
            intensity={40}
            tint={theme.isDark ? 'dark' : 'light'}
            style={{ borderRadius: 999, overflow: 'hidden' }}
          >
            {pill}
          </BlurView>
        )}
      </Pressable>
    </Animated.View>
  );
}

function SportDock({ sportCounts }: { sportCounts: SportCounts }) {
  const insets = useSafeAreaInsets();
  const { filter, setFilter } = useMapStore();
  const { t } = useT();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 110,
        left: 0,
        right: 0,
        zIndex: 9,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {FILTERS.map((f) => (
          <SportChip
            key={f}
            sport={f}
            active={filter === f}
            count={sportCounts[f]}
            label={t(`map.filters.${f}`)}
            onPress={async () => {
              await hx.tap();
              setFilter(f);
            }}
          />
        ))}
      </ScrollView>
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
  const theme = useTheme();

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
        paddingTop: insets.top + 90, // command bar only (filter dock + city badge hidden in list)
        paddingBottom: insets.bottom + 120, // tab bar only (dock moved to top)
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
              backgroundColor: theme.bg,
              borderColor: theme.fg + '1a',
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
            <Text className="font-display text-ink dark:text-paper text-xl mt-1">{s.name}</Text>
            <View className="flex-row flex-wrap gap-2 mt-3">
              {s.sports.map((sport) => {
                const stock = s.stock[sport] ?? 0;
                const out = stock === 0;
                return (
                  <View
                    key={sport}
                    style={{
                      backgroundColor: out ? theme.fg + '14' : palette.butter,
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
                        out
                          ? 'font-sans text-ink/40 dark:text-paper/40 text-xs'
                          : 'font-medium text-ink text-xs'
                      }
                    >
                      {SPORT_LABELS[sport]}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function Map() {
  const { t } = useT();
  const mapRef = useRef<MapView>(null);
  const router = useRouter();
  const { filter, viewMode, searchQuery, cacheStation } = useMapStore();

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<keyof typeof CITY_LABELS | 'generic'>('istanbul');
  const [latDelta, setLatDelta] = useState(FALLBACK_REGION.latitudeDelta);

  const allStations = useMemo(
    () => stationsNearUser(userLoc, STATIONS, { minTotal: 12, radiusKm: 5 }),
    [userLoc]
  );

  const visibleStations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = allStations;
    if (filter !== 'all') {
      list = list.filter((s) => s.sports.includes(filter as Sport));
    }
    if (q.length > 0) {
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [filter, allStations, searchQuery]);

  const sportCounts = useMemo<SportCounts>(() => {
    const c: SportCounts = {
      all: allStations.filter((s) => s.availableNow).length,
      football: 0,
      basketball: 0,
      volleyball: 0,
      paddle: 0,
      tennis: 0,
    };
    for (const s of allStations) {
      if (!s.availableNow) continue;
      for (const sp of s.sports) {
        if ((s.stock[sp] ?? 0) > 0) c[sp]++;
      }
    }
    return c;
  }, [allStations]);

  const cityActiveCount = useMemo(
    () =>
      city === 'generic'
        ? visibleStations.filter((s) => s.availableNow).length
        : visibleStations.filter((s) => s.city === city && s.availableNow).length,
    [visibleStations, city]
  );

  const cityLabel = city === 'generic' ? t('map.generic_area') : CITY_LABELS[city];

  const clustered = useMemo(
    () => clusterStations(visibleStations, latDelta),
    [visibleStations, latDelta]
  );

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') return;

        const pos = await Location.getCurrentPositionAsync({});
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLoc(next);

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
        setCity(bestDist > 200 ? 'generic' : best);

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

  const openStation = async (s: Station) => {
    await hx.press();
    cacheStation(s);
    router.push({ pathname: '/station/[id]', params: { id: s.id } });
  };

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
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
                    key={`${filter}-${searchQuery}-${item.data.id}`}
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
                  key={`${filter}-${searchQuery}-${item.data.id}`}
                  coordinate={{ latitude: item.data.lat, longitude: item.data.lng }}
                  onPress={() => openStation(item.data)}
                  tracksViewChanges={false}
                >
                  <StationMarkerView station={item.data} index={i} />
                </Marker>
              );
            })}
          </MapView>
          <CityBadge cityLabel={cityLabel} count={cityActiveCount} />
        </>
      ) : (
        <StationListView
          stations={visibleStations}
          userLoc={userLoc}
          onStationPress={openStation}
        />
      )}

      <CommandBar />
      {viewMode === 'map' && <SportDock sportCounts={sportCounts} />}
    </View>
  );
}
