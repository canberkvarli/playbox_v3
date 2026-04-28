import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Sport, Station } from '@/data/stations.seed';

type SportFilter = Sport | 'all';
type ViewMode = 'map' | 'list';

type MapStore = {
  filter: SportFilter;
  selectedStationId: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  searchFocused: boolean;
  recentSearches: string[];
  lastSelectedStation: Station | null;
  stationSheetOpen: boolean;
  pendingSheetStationId: string | null;
  // Persisted lookup of every station the user has seen on the map. Lets
  // downstream screens (reservations, history) resolve a station_id back to
  // its display name without re-deriving the full ring around userLoc.
  stationCache: Record<string, Station>;
  setFilter: (f: SportFilter) => void;
  selectStation: (id: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setSearchQuery: (q: string) => void;
  setSearchFocused: (v: boolean) => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  cacheStation: (s: Station | null) => void;
  cacheStations: (stations: Station[]) => void;
  setStationSheetOpen: (v: boolean) => void;
  setPendingSheetStationId: (id: string | null) => void;
};

export const useMapStore = create<MapStore>()(
  persist(
    (set) => ({
      filter: 'all',
      selectedStationId: null,
      viewMode: 'map',
      searchQuery: '',
      searchFocused: false,
      recentSearches: [],
      lastSelectedStation: null,
      stationSheetOpen: false,
      pendingSheetStationId: null,
      stationCache: {},
      setFilter: (filter) => set({ filter }),
      selectStation: (id) => set({ selectedStationId: id }),
      setViewMode: (viewMode) => set({ viewMode }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSearchFocused: (searchFocused) => set({ searchFocused }),
      addRecentSearch: (q) =>
        set((s) => {
          const t = q.trim();
          if (!t) return {};
          return {
            recentSearches: [t, ...s.recentSearches.filter((x) => x !== t)].slice(0, 5),
          };
        }),
      clearRecentSearches: () => set({ recentSearches: [] }),
      cacheStation: (station) =>
        set((s) => {
          if (!station) return { lastSelectedStation: null };
          return {
            lastSelectedStation: station,
            stationCache: { ...s.stationCache, [station.id]: station },
          };
        }),
      cacheStations: (stations) =>
        set((s) => {
          if (!stations.length) return {};
          const next = { ...s.stationCache };
          let changed = false;
          for (const st of stations) {
            if (!next[st.id]) {
              next[st.id] = st;
              changed = true;
            }
          }
          return changed ? { stationCache: next } : {};
        }),
      setStationSheetOpen: (stationSheetOpen) => set({ stationSheetOpen }),
      setPendingSheetStationId: (pendingSheetStationId) => set({ pendingSheetStationId }),
    }),
    {
      name: 'playbox.map',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Only persist the bits that should survive across launches. Search
      // state, sheet state etc. should reset to defaults on each open.
      partialize: (s) => ({
        recentSearches: s.recentSearches,
        stationCache: s.stationCache,
      }),
    }
  )
);
