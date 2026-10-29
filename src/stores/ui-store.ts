import { create } from "zustand";
import type { CardId, OrientedRect } from "../lib/card";
import { emitHintEvent } from "../lib/hint-events";
import type { TutorialId } from "../lib/tutorials";

export type PrefsSection =
  | "General"
  | "Workspace"
  | "Layout"
  | "Display"
  | "AI"
  | "Help"
  | "Updates"
  | "Experimental"
  | "About";

/** A setting a link can point at: Preferences opens on its section and the setting pulses twice. */
export type PrefsTarget = "livePreview" | "helpTips" | "bugReport";

/** How long help tips keep waiting after the welcome tour closes, so the first one does not fire at once. */
export const WELCOME_HINT_DELAY_MS = 2500;

let releaseHints: ReturnType<typeof setTimeout> | undefined;

/** The tutorial that is running and the step it is on. Nothing about it is saved. */
export type RunningTutorial = { id: TutorialId; step: number };

/** The two halves of the app: define where the cards are, then choose what to print. */
export type Stage = "cards" | "print";

/**
 * A piece shown large over the Print tab (right-click on it): where it is in its source and how it prints, `width`
 * and `height` being its printed shape (points or any unit, only their ratio counts).
 */
export type PiecePeek = { card: CardId; source: OrientedRect; turn: number; width: number; height: number };

/** Transient UI state (not persisted). */
export const useUiStore = create<{
  prefsOpen: boolean;
  /** Section to show next time the dialog opens (set by "open preferences" links), then cleared. */
  prefsSection: PrefsSection | null;
  /** The setting a link pointed at, pulsing until its animation ends or the dialog closes. */
  prefsPulse: PrefsTarget | null;
  setPrefsOpen: (open: boolean, section?: PrefsSection, target?: PrefsTarget) => void;
  clearPrefsPulse: () => void;
  /** Preferences › Updates should put the focus on its Install button when it shows it (the update toast), then clear this. */
  focusInstall: boolean;
  setFocusInstall: (focus: boolean) => void;
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
  /** The Tutorials list (Help menu). */
  tutorialsOpen: boolean;
  setTutorialsOpen: (open: boolean) => void;
  /** The tutorial the user started, if one is running (`TutorialHost` shows it). */
  tutorial: RunningTutorial | null;
  /** Starts a tutorial from its first step, closing the list and Preferences it was picked from. */
  startTutorial: (id: TutorialId) => void;
  setTutorialStep: (step: number) => void;
  endTutorial: () => void;
  /** Help tips wait while the welcome or a tutorial is open and for a moment after it closes. */
  hintsHeld: boolean;
  /** An export is running: the automatic update check waits for it to finish. */
  exporting: boolean;
  setExporting: (exporting: boolean) => void;
  /** Always starts in the Cards stage; switching never changes a document. */
  stage: Stage;
  setStage: (stage: Stage) => void;
  /** The piece shown large, or null. */
  peek: PiecePeek | null;
  setPeek: (peek: PiecePeek | null) => void;
}>((set) => ({
  prefsOpen: false,
  prefsSection: null,
  prefsPulse: null,
  setPrefsOpen: (prefsOpen, section, target) =>
    set({ prefsOpen, prefsSection: section ?? null, prefsPulse: prefsOpen ? (target ?? null) : null }),
  clearPrefsPulse: () => set({ prefsPulse: null }),
  focusInstall: false,
  setFocusInstall: (focusInstall) => set({ focusInstall }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  welcomeOpen: false,
  setWelcomeOpen: (welcomeOpen) => {
    clearTimeout(releaseHints);
    set({ welcomeOpen, hintsHeld: true });
    if (!welcomeOpen) releaseHints = setTimeout(() => set({ hintsHeld: false }), WELCOME_HINT_DELAY_MS);
  },
  tutorialsOpen: false,
  setTutorialsOpen: (tutorialsOpen) => set({ tutorialsOpen }),
  tutorial: null,
  startTutorial: (id) => {
    clearTimeout(releaseHints);
    set({
      tutorial: { id, step: 0 },
      hintsHeld: true,
      tutorialsOpen: false,
      prefsOpen: false,
      prefsSection: null,
      prefsPulse: null,
    });
  },
  setTutorialStep: (step) => set((s) => (s.tutorial ? { tutorial: { ...s.tutorial, step } } : s)),
  endTutorial: () => {
    clearTimeout(releaseHints);
    set({ tutorial: null, hintsHeld: true });
    releaseHints = setTimeout(() => set((s) => (s.welcomeOpen ? s : { hintsHeld: false })), WELCOME_HINT_DELAY_MS);
  },
  welcomeDeferred: false,
  deferWelcome: (welcomeDeferred = true) => set({ welcomeDeferred }),
  hintsHeld: false,
  exporting: false,
  setExporting: (exporting) => set({ exporting }),
  peek: null,
  setPeek: (peek) => set({ peek }),
  stage: "cards",
  setStage: (stage) => {
    set({ stage });
    emitHintEvent(stage === "print" ? "stage-changed:print" : "stage-changed:cards");
  },
}));
