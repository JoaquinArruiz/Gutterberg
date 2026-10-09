import { create } from "zustand";
import { emitHintEvent } from "../lib/hint-events";

export type PrefsSection = "General" | "Workspace" | "Preview" | "Appearance" | "AI" | "Help" | "About";

/** How long help tips keep waiting after the welcome tour closes, so the first one does not fire at once. */
export const WELCOME_HINT_DELAY_MS = 2500;

let releaseHints: ReturnType<typeof setTimeout> | undefined;

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
  /** The welcome tour (M25) is open. */
  welcomeOpen: boolean;
  setWelcomeOpen: (open: boolean) => void;
  /**
   * The app was started with a file to open (M15's file association): the welcome does not open over the start
   * screen this time. It is dropped as soon as a document is open, so the next start screen shows it.
   */
  welcomeDeferred: boolean;
  deferWelcome: (deferred?: boolean) => void;
  /** Help tips wait while the welcome is open and for a moment after it closes. */
  hintsHeld: boolean;
  /** Always starts in the Cards stage; switching never changes a document. */
  stage: Stage;
  setStage: (stage: Stage) => void;
}>((set) => ({
  prefsOpen: false,
  prefsSection: null,
  setPrefsOpen: (prefsOpen, section) => set({ prefsOpen, prefsSection: section ?? null }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  welcomeOpen: false,
  setWelcomeOpen: (welcomeOpen) => {
    clearTimeout(releaseHints);
    set({ welcomeOpen, hintsHeld: true });
    if (!welcomeOpen) releaseHints = setTimeout(() => set({ hintsHeld: false }), WELCOME_HINT_DELAY_MS);
  },
  welcomeDeferred: false,
  deferWelcome: (welcomeDeferred = true) => set({ welcomeDeferred }),
  hintsHeld: false,
  stage: "cards",
  setStage: (stage) => {
    set({ stage });
    if (stage === "print") emitHintEvent("stage-changed:print");
  },
}));
