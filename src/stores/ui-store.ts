import { create } from "zustand";

export type PrefsSection = "General" | "Workspace" | "Preview" | "Appearance" | "About";

/** The two halves of the app: define where the cards are, then choose what to print. */
export type Stage = "cards" | "print";

/** Transient UI state (not persisted). */
export const useUiStore = create<{
  prefsOpen: boolean;
  /** Section to show next time the dialog opens (set by "open preferences" links), then cleared. */
  prefsSection: PrefsSection | null;
  setPrefsOpen: (open: boolean, section?: PrefsSection) => void;
  /** Always starts in the Cards stage; switching never changes a document. */
  stage: Stage;
  setStage: (stage: Stage) => void;
}>((set) => ({
  prefsOpen: false,
  prefsSection: null,
  setPrefsOpen: (prefsOpen, section) => set({ prefsOpen, prefsSection: section ?? null }),
  stage: "cards",
  setStage: (stage) => set({ stage }),
}));
