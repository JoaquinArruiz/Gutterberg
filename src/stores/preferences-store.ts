import { create } from "zustand";
import type { MeasurementUnit } from "../lib/measurement";
import {
  DEFAULT_PREFERENCES, migratePreferences, moveMode, normalizePreferences, toggleMode,
  type AppPreferences, type DefaultWorkspace, type LivePreviewPreference, type ThemePreference, type WorkspaceMode,
} from "../lib/preferences";

/** Minimal key/value storage (localStorage-shaped) so persistence is testable and swappable. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PREFERENCES_KEY = "pdf-card-editor:preferences";

/** The webview's localStorage (persisted in the app's data directory), or an in-memory fallback if blocked. */
export function browserStorage(): KeyValueStorage {
  try {
    const s = globalThis.localStorage;
    s.getItem(PREFERENCES_KEY); // throws when site data is blocked
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

/** Load -> validate -> migrate -> merge with defaults. Never throws; corrupt data yields defaults. */
export function loadPreferences(storage: KeyValueStorage): AppPreferences {
  try {
    const text = storage.getItem(PREFERENCES_KEY);
    return text ? migratePreferences(JSON.parse(text)) : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

type PreferencesState = {
  prefs: AppPreferences;
  setUnit: (unit: MeasurementUnit) => void;
  setVisibleMode: (mode: WorkspaceMode, enabled: boolean) => void;
  moveVisibleMode: (mode: WorkspaceMode, dir: -1 | 1) => void;
  setDefaultMode: (mode: DefaultWorkspace) => void;
  /** Remember the workspace the user switched to. Never changes `defaultMode`. */
  rememberMode: (mode: WorkspaceMode) => void;
  setLivePreview: (p: LivePreviewPreference) => void;
  setTheme: (t: ThemePreference) => void;
  resetToDefaults: () => void;
};

/** Store factory; the app uses the singleton below, tests pass their own storage. */
export function createPreferencesStore(storage: KeyValueStorage) {
  return create<PreferencesState>((set, get) => {
    // Every change goes through normalize (repairs invariants) and is saved.
    const commit = (next: AppPreferences) => {
      const prefs = normalizePreferences(next);
      set({ prefs });
      try {
        storage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
      } catch {
        /* storage unavailable: preferences still apply for this run */
      }
    };
    const edit = (f: (p: AppPreferences) => AppPreferences) => commit(f(get().prefs));

    return {
      prefs: loadPreferences(storage),
      setUnit: (unit) => edit((p) => ({ ...p, measurement: { unit } })),
      setVisibleMode: (mode, enabled) =>
        edit((p) => ({ ...p, workspace: { ...p.workspace, visibleModes: toggleMode(p.workspace.visibleModes, mode, enabled) } })),
      moveVisibleMode: (mode, dir) =>
        edit((p) => ({ ...p, workspace: { ...p.workspace, visibleModes: moveMode(p.workspace.visibleModes, mode, dir) } })),
      setDefaultMode: (defaultMode) => edit((p) => ({ ...p, workspace: { ...p.workspace, defaultMode } })),
      rememberMode: (lastMode) => {
        if (get().prefs.workspace.lastMode !== lastMode) edit((p) => ({ ...p, workspace: { ...p.workspace, lastMode } }));
      },
      setLivePreview: (livePreview) => edit((p) => ({ ...p, preview: { livePreview } })),
      setTheme: (theme) => edit((p) => ({ ...p, appearance: { theme } })),
      resetToDefaults: () => commit(DEFAULT_PREFERENCES),
    };
  });
}

export const usePreferencesStore = createPreferencesStore(browserStorage());

/** Unit currently chosen for displaying/typing measurements. */
export const useUnit = () => usePreferencesStore((s) => s.prefs.measurement.unit);
