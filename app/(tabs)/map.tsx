import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import MapView, { PROVIDER_DEFAULT, Marker, Circle, Region } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
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
import { rankStations } from '@/lib/search';
import { StationSheet, type StationSheetHandle } from '@/components/StationSheet';
import { useMenuStore } from '@/stores/menuStore';
import { ReservationsPanel } from '@/components/ReservationsPanel';

const FALLBACK_REGION: Region = {
  latitude: 41.0370, // Taksim
  longitude: 28.9850,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

const FILTERS: Array<Sport | 'all'> = ['all', 'football', 'basketball', 'volleyball', 'tennis'];

type SportCounts = Record<Sport | 'all', number>;

function StationMarkerView({
  station,
  index,
  dimmed = false,
}: {
  station: Station;
  index: number;
  dimmed?: boolean;
}) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      index * 40,
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    // Dimmed pins fade to ~25% so they stay visually present (showing density)
    // without competing with the active-filter pins for attention.
    opacity: enter.value * (dimmed ? 0.25 : 1),
    transform: [{ scale: 0.85 + 0.15 * enter.value }],
  }));

  // Show up to 3 sport emojis stacked horizontally so users see at a glance
  // that one station hosts multiple games.
  const visibleSports = station.sports.slice(0, 3);
  const overflow = Math.max(0, station.sports.length - 3);
  const baseW = 30;
  const perEmoji = 18;
  const width = baseW + visibleSports.length * perEmoji + (overflow > 0 ? 14 : 0);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: palette.butter,
          borderRadius: 16,
          height: 40,
          width,
          paddingHorizontal: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          borderWidth: 2,
          borderColor: palette.ink,
          shadowColor: palette.ink,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.22,
          shadowRadius: 5,
          elevation: 5,
        },
        style,
      ]}
    >
      {visibleSports.map((sp) => (
        <Text key={sp} style={{ fontSize: 16 }}>
          {SPORT_EMOJI[sp]}
        </Text>
      ))}
      {overflow > 0 ? (
        <Text
          style={{
            fontSize: 10,
            color: palette.ink,
            fontWeight: '700',
            marginLeft: 2,
          }}
        >
          +{overflow}
        </Text>
      ) : null}
      {station.availableNow && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: palette.coral,
            borderWidth: 2,
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
  const {
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    setSearchFocused,
    addRecentSearch,
  } = useMapStore();
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
  const onSubmit = () => {
    if (searchQuery.trim().length > 0) addRecentSearch(searchQuery);
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
        <Feather name="search" size={18} color={palette.ink} />
        <TextInput
          ref={inputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onSubmitEditing={onSubmit}
          placeholder={t('map.search.placeholder')}
          placeholderTextColor={palette.ink + 'aa'}
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

function SearchSuggestions({
  stations,
  userLoc,
  onPickStation,
}: {
  stations: Station[];
  userLoc: { lat: number; lng: number } | null;
  onPickStation: (s: Station) => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const searchFocused = useMapStore((s) => s.searchFocused);
  const searchQuery = useMapStore((s) => s.searchQuery);
  const recentSearches = useMapStore((s) => s.recentSearches);
  const setSearchQuery = useMapStore((s) => s.setSearchQuery);
  const clearRecentSearches = useMapStore((s) => s.clearRecentSearches);

  if (!searchFocused || searchQuery.trim().length > 0) return null;

  const nearby = (
    userLoc
      ? [...stations]
          .filter((s) => s.availableNow)
          .sort(
            (a, b) =>
              haversineKm(userLoc, { lat: a.lat, lng: a.lng }) -
              haversineKm(userLoc, { lat: b.lat, lng: b.lng })
          )
      : stations.filter((s) => s.availableNow)
  ).slice(0, 3);

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + 76,
        left: 16,
        right: 16,
        zIndex: 9,
      }}
    >
      <BlurView
        intensity={60}
        tint={theme.isDark ? 'dark' : 'light'}
        style={{
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: theme.bg + 'f0',
          borderWidth: 1,
          borderColor: theme.fg + '14',
          padding: 16,
          gap: 16,
        }}
      >
        {recentSearches.length > 0 ? (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text className="font-medium text-ink dark:text-paper uppercase tracking-wider text-[12px] font-bold">
                {t('map.suggest.recent')}
              </Text>
              <Pressable onPress={clearRecentSearches} hitSlop={6}>
                <Text className="font-sans text-ink dark:text-paper font-semibold text-[11px]">
                  {t('map.suggest.clear')}
                </Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recentSearches.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setSearchQuery(q)}
                  style={{
                    backgroundColor: theme.fg + '0d',
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Feather name="clock" size={12} color={theme.fg + '88'} />
                  <Text className="font-sans text-ink dark:text-paper text-sm">{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {nearby.length > 0 ? (
          <View>
            <Text className="font-medium text-ink dark:text-paper uppercase tracking-wider text-[12px] font-bold mb-2">
              {t('map.suggest.nearby')}
            </Text>
            <View style={{ gap: 2 }}>
              {nearby.map((s) => {
                const km = userLoc
                  ? haversineKm(userLoc, { lat: s.lat, lng: s.lng })
                  : null;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onPickStation(s)}
                    style={({ pressed }) => ({
                      paddingVertical: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      opacity: pressed ? 0.55 : 1,
                    })}
                  >
                    <Feather name="map-pin" size={15} color={palette.coral} />
                    <Text className="flex-1 font-medium text-ink dark:text-paper text-[15px]">
                      {s.name}
                    </Text>
                    {km !== null ? (
                      <Text className="font-mono text-ink dark:text-paper font-bold text-xs">
                        {km < 10 ? km.toFixed(1) : km.toFixed(0)} km
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
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
          fontFamily: 'Unbounded_700Bold',
          fontSize: 13,
          color: palette.ink,
          textTransform: 'lowercase',
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      {!active && count > 0 ? (
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            fontSize: 11,
            color: palette.ink,
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
                          ? 'font-sans text-ink dark:text-paper font-semibold text-xs'
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

function TopBarPill({
  children,
  onPress,
  accessibilityLabel,
  square,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  square?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.93 : 1 }],
      })}
    >
      {/* Inner View carries the visual styling so it never gets swallowed
          by a Pressable behavior or background being overridden. */}
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 999,
          height: 46,
          minWidth: 46,
          paddingHorizontal: square ? 0 : 16,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: palette.ink + '30',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        {children}
      </View>
    </Pressable>
  );
}

function TopBar({
  onLocate,
  onMenu,
  sheetIndex,
}: {
  onLocate: () => void;
  onMenu: () => void;
  // Sheet's animated snap index (continuous). When it crosses 1 on its way to 2
  // (the fullscreen snap) we fade the TopBar out so the sheet's header has room
  // to breathe. Optional — TopBar works standalone too.
  sheetIndex?: SharedValue<number>;
}) {
  const insets = useSafeAreaInsets();

  const animatedStyle = useAnimatedStyle(() => {
    const i = sheetIndex?.value ?? 0;
    // Fade + drift upward as the sheet travels from its mid snap (1) to full (2).
    // Below 1: fully visible. Above 2: fully hidden. Clamped both ends.
    const opacity = interpolate(i, [1, 2], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(i, [1, 2], [0, -12], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const pointerStyle = useAnimatedStyle(() => {
    const i = sheetIndex?.value ?? 0;
    // Disable hit-testing once the bar is mostly faded out so taps fall through
    // to whatever is behind. Reanimated can't set pointerEvents, so we route via
    // a CSS-style hack: when faded, lift the z-index below the sheet.
    return { zIndex: i > 1.5 ? 0 : 1000 };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          top: insets.top + 12,
          left: 16,
          right: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          elevation: 1000,
        },
        animatedStyle,
        pointerStyle,
      ]}
    >
      <TopBarPill square onPress={onLocate} accessibilityLabel="locate me">
        <Feather name="navigation" size={18} color={palette.ink} />
      </TopBarPill>
      <TopBarPill>
        <Text
          className="font-display-x"
          style={{
            color: palette.ink,
            fontSize: 17,
            letterSpacing: 0.6,
            lineHeight: 20,
            includeFontPadding: false,
          }}
        >
          Playbox
        </Text>
      </TopBarPill>
      <TopBarPill square onPress={onMenu} accessibilityLabel="menu">
        <Feather name="menu" size={18} color={palette.ink} />
      </TopBarPill>
    </Animated.View>
  );
}

function HomeBottomSheet({
  stations,
  userLoc,
  onPickStation,
  animatedIndex,
}: {
  stations: Station[];
  userLoc: { lat: number; lng: number } | null;
  onPickStation: (s: Station) => void;
  animatedIndex?: SharedValue<number>;
}) {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const [segment, setSegment] = useState<'stations' | 'reservations'>('stations');
  const [showFilters, setShowFilters] = useState(false);

  const filter = useMapStore((s) => s.filter);
  const setFilter = useMapStore((s) => s.setFilter);
  const searchQuery = useMapStore((s) => s.searchQuery);
  const setSearchQuery = useMapStore((s) => s.setSearchQuery);

  const sorted = useMemo(() => {
    if (!userLoc) return stations;
    return [...stations].sort(
      (a, b) =>
        haversineKm(userLoc, { lat: a.lat, lng: a.lng }) -
        haversineKm(userLoc, { lat: b.lat, lng: b.lng })
    );
  }, [stations, userLoc]);

  const onFilterPress = async (f: Sport | 'all') => {
    await hx.tap();
    setFilter(f);
  };

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={['22%', '65%', '94%']}
      index={0}
      animatedIndex={animatedIndex}
      // Keep the sheet's top edge below the notch / status bar — otherwise the
      // search row and filters pill butt up against the Dynamic Island.
      topInset={insets.top}
      backgroundStyle={{
        backgroundColor: theme.bg,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
      }}
      handleIndicatorStyle={{ backgroundColor: theme.fg + '26', width: 44, height: 5 }}
    >
      <BottomSheetScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24,
        }}
      >
      <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
        {/* Search bar with filter button */}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View
            style={{
              flex: 1,
              backgroundColor: theme.fg + '08',
              borderRadius: 18,
              paddingHorizontal: 16,
              paddingVertical: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Feather name="search" size={18} color={palette.ink} />
            <BottomSheetTextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('map.search.placeholder')}
              placeholderTextColor={palette.ink + 'aa'}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                fontSize: 15,
                color: theme.fg,
                padding: 0,
              }}
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                <Feather name="x" size={16} color={theme.fg + '88'} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={async () => {
              await hx.tap();
              setShowFilters((v) => !v);
            }}
            style={{
              width: 50,
              height: 50,
              borderRadius: 18,
              backgroundColor:
                showFilters || filter !== 'all' ? palette.ink : theme.fg + '08',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather
              name="sliders"
              size={18}
              color={showFilters || filter !== 'all' ? palette.paper : theme.fg}
            />
            {filter !== 'all' ? (
              <View
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: palette.coral,
                  borderWidth: 1.5,
                  borderColor: theme.bg,
                }}
              />
            ) : null}
          </Pressable>
        </View>

        {/* Filter chips */}
        {showFilters ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          >
            {FILTERS.map((f) => {
              const active = filter === f;
              const emoji = f === 'all' ? '🎯' : SPORT_EMOJI[f];
              return (
                <Pressable
                  key={f}
                  onPress={() => onFilterPress(f)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: active ? palette.coral : theme.fg + '08',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{emoji}</Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: active ? palette.paper : theme.fg,
                      fontWeight: '600',
                      letterSpacing: 0.2,
                    }}
                  >
                    {t(`map.filters.${f}`)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Segments — taller, bolder so they feel intentional, not crammed */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: theme.fg + '08',
            borderRadius: 18,
            padding: 5,
            marginTop: 4,
          }}
        >
          {(['stations', 'reservations'] as const).map((seg) => {
            const active = segment === seg;
            return (
              <Pressable
                key={seg}
                onPress={async () => {
                  if (seg === segment) return;
                  await hx.tap();
                  setSegment(seg);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: active ? theme.bg : 'transparent',
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: active ? 2 : 0 },
                  shadowOpacity: active ? 0.1 : 0,
                  shadowRadius: active ? 4 : 0,
                  elevation: active ? 2 : 0,
                }}
              >
                <Text
                  style={{
                    color: palette.ink,
                    fontFamily: active ? 'Unbounded_800ExtraBold' : 'Unbounded_700Bold',
                    fontSize: 14,
                    letterSpacing: 0.3,
                    opacity: active ? 1 : 0.7,
                  }}
                >
                  {t(`map.segment.${seg}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Section title between header and rows — makes the structure obvious */}
        {segment === 'stations' ? (
          <View style={{ marginTop: 8, paddingHorizontal: 4 }}>
            <Text
              className="font-display-x"
              style={{ color: theme.fg, fontSize: 22, lineHeight: 26, letterSpacing: 0.2 }}
            >
              {t('map.section.nearby')}
            </Text>
            <Text
              style={{
                color: palette.ink,
                fontSize: 12,
                letterSpacing: 1,
                marginTop: 4,
                fontFamily: 'Unbounded_700Bold',
                textTransform: 'uppercase',
              }}
            >
              {sorted.length} {t('map.section.station_count')}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 18,
          gap: 10,
        }}
      >
        {segment === 'stations' ? (
          sorted.length === 0 ? (
            <Text className="font-sans text-ink dark:text-paper text-base text-center font-semibold mt-8">
              {t('map.empty.no_stations')}
            </Text>
          ) : (
            sorted.map((s) => {
              const km = userLoc
                ? haversineKm(userLoc, { lat: s.lat, lng: s.lng })
                : null;
              const dimmed = filter !== 'all' && !s.sports.includes(filter as Sport);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onPickStation(s)}
                  style={({ pressed }) => ({
                    backgroundColor: theme.bg,
                    borderColor: theme.fg + '12',
                    borderWidth: 1,
                    borderRadius: 20,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    transform: [{ scale: pressed ? 0.99 : 1 }],
                    opacity: dimmed ? 0.35 : s.availableNow ? 1 : 0.6,
                  })}
                >
                  {/* Sport emojis left-aligned */}
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 2,
                      width: 52,
                      justifyContent: 'flex-start',
                    }}
                  >
                    {s.sports.map((sp) => (
                      <Text key={sp} style={{ fontSize: s.sports.length > 2 ? 16 : 22 }}>
                        {SPORT_EMOJI[sp]}
                      </Text>
                    ))}
                  </View>

                  {/* Name + status */}
                  <View style={{ flex: 1 }}>
                    <Text
                      className="font-display"
                      style={{
                        fontSize: 16,
                        lineHeight: 20,
                        color: theme.fg,
                      }}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    <Text
                      className="font-mono"
                      style={{
                        fontSize: 12,
                        color: s.availableNow ? '#2a8a52' : palette.coral,
                        fontWeight: '600',
                        marginTop: 3,
                      }}
                    >
                      {s.availableNow ? 'açık' : 'kapalı'}
                    </Text>
                  </View>

                  {/* Distance + chevron */}
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    {km !== null ? (
                      <Text
                        className="font-mono"
                        style={{
                          fontSize: 13,
                          color: theme.fg,
                          fontWeight: '600',
                        }}
                      >
                        {km < 10 ? km.toFixed(1) : km.toFixed(0)} km
                      </Text>
                    ) : null}
                    <Feather name="chevron-right" size={16} color={theme.fg + '55'} />
                  </View>
                </Pressable>
              );
            })
          )
        ) : (
          <ReservationsPanel />
        )}
      </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

export default function Map() {
  const { t } = useT();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const stationSheetRef = useRef<StationSheetHandle>(null);
  const { filter, viewMode, searchQuery, setViewMode, cacheStation } = useMapStore();
  const stationSheetOpen = useMapStore((s) => s.stationSheetOpen);
  const pendingSheetStationId = useMapStore((s) => s.pendingSheetStationId);
  const setPendingSheetStationId = useMapStore((s) => s.setPendingSheetStationId);

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState<keyof typeof CITY_LABELS | 'generic'>('istanbul');
  const [latDelta, setLatDelta] = useState(FALLBACK_REGION.latitudeDelta);
  // Writable shared value — @gorhom/bottom-sheet writes the live snap position
  // into it (continuous, not just on snap). TopBar reads it to fade smoothly.
  const homeSheetAnimatedIndex = useSharedValue(0);

  const allStations = useMemo(
    () => stationsNearUser(userLoc, STATIONS, { minTotal: 12, radiusKm: 5 }),
    [userLoc]
  );

  // Search filters hard (hide) but sport filter is soft (dim). Keep non-matching
  // stations around so users still see where stuff exists — picking volleyball
  // shouldn't make the basketball court across the street vanish.
  const matchesFilter = useCallback(
    (s: Station) => filter === 'all' || s.sports.includes(filter as Sport),
    [filter]
  );

  const visibleStations = useMemo(
    () => rankStations(allStations, searchQuery, userLoc),
    [allStations, searchQuery, userLoc]
  );

  const sportCounts = useMemo<SportCounts>(() => {
    const c: SportCounts = {
      all: allStations.filter((s) => s.availableNow).length,
      football: 0,
      basketball: 0,
      volleyball: 0,
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
      visibleStations.filter(
        (s) =>
          s.availableNow &&
          matchesFilter(s) &&
          (city === 'generic' || s.city === city)
      ).length,
    [visibleStations, matchesFilter, city]
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

  useEffect(() => {
    if (!pendingSheetStationId) return;
    const s =
      allStations.find((x) => x.id === pendingSheetStationId) ??
      STATIONS.find((x) => x.id === pendingSheetStationId);
    if (s) {
      cacheStation(s);
      mapRef.current?.animateToRegion(
        {
          latitude: s.lat,
          longitude: s.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        500
      );
      setTimeout(() => stationSheetRef.current?.open(s), 400);
    }
    setPendingSheetStationId(null);
  }, [pendingSheetStationId, allStations, cacheStation, setPendingSheetStationId]);

  const onRegionChangeComplete = (region: Region) => {
    setLatDelta(region.latitudeDelta);
  };

  const openStation = async (s: Station) => {
    await hx.press();
    cacheStation(s);
    // Direct navigation to the full station page (new gate-selector flow).
    // The legacy StationSheet preview is no longer the canonical entry.
    router.push({ pathname: '/station/[id]', params: { id: s.id } });
  };

  const openStationFromList = async (s: Station) => {
    await hx.press();
    cacheStation(s);
    // Switch to map mode so the sheet layers over the map, then center + open.
    if (viewMode === 'list') {
      setViewMode('map');
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
        setTimeout(() => stationSheetRef.current?.open(s), 600);
      });
    } else {
      stationSheetRef.current?.open(s);
    }
  };

  const onLocate = async () => {
    await hx.tap();
    if (!userLoc) return;
    mapRef.current?.animateToRegion(
      {
        latitude: userLoc.lat,
        longitude: userLoc.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      600
    );
  };

  const onMenu = async () => {
    await hx.tap();
    useMenuStore.getState().setOpen(true);
  };

  const onPickStationFromSheet = async (s: Station) => {
    await hx.press();
    cacheStation(s);
    router.push({ pathname: '/station/[id]', params: { id: s.id } });
  };

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
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
              <StationMarkerView
                station={item.data}
                index={i}
                dimmed={!matchesFilter(item.data)}
              />
            </Marker>
          );
        })}
      </MapView>

      {!stationSheetOpen && (
        <HomeBottomSheet
          stations={visibleStations}
          userLoc={userLoc}
          onPickStation={onPickStationFromSheet}
          animatedIndex={homeSheetAnimatedIndex}
        />
      )}
      <StationSheet ref={stationSheetRef} />
      {/* TopBar renders LAST so it stacks above the sheet. Its opacity is driven
          by the sheet's animatedIndex, so it smoothly fades + drifts up as the
          user pulls the sheet to full height — no more hard pop. */}
      {!stationSheetOpen && (
        <TopBar
          onLocate={onLocate}
          onMenu={onMenu}
          sheetIndex={homeSheetAnimatedIndex}
        />
      )}
    </View>
  );
}
