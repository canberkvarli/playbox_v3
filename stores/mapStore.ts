import { create } from 'zustand';
import type { Sport } from '@/data/stations.seed';

type SportFilter = Sport | 'all';

type MapStore = {
  filter: SportFilter;
  selectedStationId: string | null;
  setFilter: (f: SportFilter) => void;
  selectStation: (id: string | null) => void;
};

export const useMapStore = create<MapStore>((set) => ({
  filter: 'all',
  selectedStationId: null,
  setFilter: (filter) => set({ filter }),
  selectStation: (id) => set({ selectedStationId: id }),
}));
