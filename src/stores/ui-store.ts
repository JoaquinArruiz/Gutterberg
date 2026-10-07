import { create } from "zustand";

export type PrefsSection = "General" | "Workspace" | "Preview" | "Appearance" | "About";

/** Transient UI state (not persisted). */
export const useUiStore = create<{
  prefsOpen: boolean;
  /** Section to show next time the dialog opens (set by "open preferences" links), then cleared. */
  prefsSection: PrefsSection | null;
  setPrefsOpen: (open: boolean, section?: PrefsSection) => void;
}>((set) => ({
  prefsOpen: false,
  prefsSection: null,
  setPrefsOpen: (prefsOpen, section) => set({ prefsOpen, prefsSection: section ?? null }),
}));
