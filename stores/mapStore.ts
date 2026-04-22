import { create } from 'zustand';
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
  setFilter: (f: SportFilter) => void;
  selectStation: (id: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setSearchQuery: (q: string) => void;
  setSearchFocused: (v: boolean) => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  cacheStation: (s: Station | null) => void;
  setStationSheetOpen: (v: boolean) => void;
  setPendingSheetStationId: (id: string | null) => void;
};

export const useMapStore = create<MapStore>((set) => ({
  filter: 'all',
  selectedStationId: null,
  viewMode: 'map',
  searchQuery: '',
  searchFocused: false,
  recentSearches: [],
  lastSelectedStation: null,
  stationSheetOpen: false,
  pendingSheetStationId: null,
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
  cacheStation: (lastSelectedStation) => set({ lastSelectedStation }),
  setStationSheetOpen: (stationSheetOpen) => set({ stationSheetOpen }),
  setPendingSheetStationId: (pendingSheetStationId) => set({ pendingSheetStationId }),
}));
