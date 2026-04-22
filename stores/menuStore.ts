import { create } from 'zustand';

type MenuStore = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

export const useMenuStore = create<MenuStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
