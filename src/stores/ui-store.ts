import { create } from "zustand";
import { emitHintEvent } from "../lib/hint-events";

export type PrefsSection = "General" | "Workspace" | "Preview" | "Appearance" | "AI" | "About";

/** The two halves of the app: define where the cards are, then choose what to print. */
export type Stage = "cards" | "print";

/** Transient UI state (not persisted). */
export const useUiStore = create<{
  prefsOpen: boolean;
  /** Section to show next time the dialog opens (set by "open preferences" links), then cleared. */
  prefsSection: PrefsSection | null;
  setPrefsOpen: (open: boolean, section?: PrefsSection) => void;
  /** The keyboard shortcuts sheet (`?`, or File menu). */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** Always starts in the Cards stage; switching never changes a document. */
  stage: Stage;
  setStage: (stage: Stage) => void;
}>((set) => ({
  prefsOpen: false,
  prefsSection: null,
  setPrefsOpen: (prefsOpen, section) => set({ prefsOpen, prefsSection: section ?? null }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  stage: "cards",
  setStage: (stage) => {
    set({ stage });
    if (stage === "print") emitHintEvent("stage-changed:print");
  },
}));
