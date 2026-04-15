import { create } from 'zustand';
import type { Sport, Station } from '@/data/stations.seed';

type SportFilter = Sport | 'all';
type ViewMode = 'map' | 'list';

type MapStore = {
  filter: SportFilter;
  selectedStationId: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  lastSelectedStation: Station | null;
  stationSheetOpen: boolean;
  pendingSheetStationId: string | null;
  setFilter: (f: SportFilter) => void;
  selectStation: (id: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setSearchQuery: (q: string) => void;
  cacheStation: (s: Station | null) => void;
  setStationSheetOpen: (v: boolean) => void;
  setPendingSheetStationId: (id: string | null) => void;
};

export const useMapStore = create<MapStore>((set) => ({
  filter: 'all',
  selectedStationId: null,
  viewMode: 'map',
  searchQuery: '',
  lastSelectedStation: null,
  stationSheetOpen: false,
  pendingSheetStationId: null,
  setFilter: (filter) => set({ filter }),
  selectStation: (id) => set({ selectedStationId: id }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  cacheStation: (lastSelectedStation) => set({ lastSelectedStation }),
  setStationSheetOpen: (stationSheetOpen) => set({ stationSheetOpen }),
  setPendingSheetStationId: (pendingSheetStationId) => set({ pendingSheetStationId }),
}));
