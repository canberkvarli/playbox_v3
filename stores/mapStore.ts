import { create } from 'zustand';
import type { Sport } from '@/data/stations.seed';

type SportFilter = Sport | 'all';
type ViewMode = 'map' | 'list';

type MapStore = {
  filter: SportFilter;
  selectedStationId: string | null;
  viewMode: ViewMode;
  setFilter: (f: SportFilter) => void;
  selectStation: (id: string | null) => void;
  setViewMode: (m: ViewMode) => void;
};

export const useMapStore = create<MapStore>((set) => ({
  filter: 'all',
  selectedStationId: null,
  viewMode: 'map',
  setFilter: (filter) => set({ filter }),
  selectStation: (id) => set({ selectedStationId: id }),
  setViewMode: (viewMode) => set({ viewMode }),
}));
