import { create } from 'zustand';

interface ThumbStore {
  map: Record<string, ImageData>;
  set(id: string, data: ImageData): void;
  clear(): void;
  enabled: boolean;
  setEnabled(v: boolean): void;
}

export const useThumbs = create<ThumbStore>((set) => ({
  map: {},
  enabled: true,
  set(id, data) {
    set((s) => ({ map: { ...s.map, [id]: data } }));
  },
  clear() {
    set({ map: {} });
  },
  setEnabled(v) {
    set({ enabled: v });
  },
}));
