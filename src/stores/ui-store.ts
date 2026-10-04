import { create } from "zustand";

/** Transient UI state (not persisted). */
export const useUiStore = create<{ prefsOpen: boolean; setPrefsOpen: (open: boolean) => void }>((set) => ({
  prefsOpen: false,
  setPrefsOpen: (prefsOpen) => set({ prefsOpen }),
}));
