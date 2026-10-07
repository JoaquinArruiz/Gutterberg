import { create } from "zustand";
import type { HintId } from "../lib/hints";
import type { MeasurementUnit } from "../lib/measurement";
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  type DefaultWorkspace,
  type LivePreviewPreference,
  migratePreferences,
  moveMode,
  normalizePreferences,
  type ThemePreference,
  toggleMode,
  type WorkspaceMode,
} from "../lib/preferences";
import {
  applyPreset,
  defaultLayout,
  type LayoutPresetId,
  type PanelId,
  type PanelPosition,
  type RegionPosition,
  setPanelCollapsed,
  setPanelPosition,
  type WorkspaceLayoutPrefs,
} from "../lib/workspace-layout";

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

/**
 * Load -> validate -> migrate -> merge with defaults. Never throws; corrupt data yields defaults.
 * "Remember ..." switches are honoured here: when off, the saved sizes / collapsed state are not restored.
 */
export function loadPreferences(storage: KeyValueStorage): AppPreferences {
  try {
    const text = storage.getItem(PREFERENCES_KEY);
    if (!text) return DEFAULT_PREFERENCES;
    const prefs = migratePreferences(JSON.parse(text));
    const l = prefs.workspace.layout;
    const layout: WorkspaceLayoutPrefs = {
      ...l,
      regionSizes: l.rememberSizes ? l.regionSizes : {},
      panels: l.panels.map(({ stackSize, collapsed, ...p }) => ({
        ...p,
        ...(l.rememberSizes && stackSize ? { stackSize } : {}),
        ...(l.rememberCollapsed && collapsed ? { collapsed } : {}),
      })),
    };
    return { ...prefs, workspace: { ...prefs.workspace, layout } };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

type PreferencesState = {
  prefs: AppPreferences;
  /** Bumped when sizes are reset so resizable groups remount with the new defaults. Not persisted. */
  layoutEpoch: number;
  setUnit: (unit: MeasurementUnit) => void;
  setVisibleMode: (mode: WorkspaceMode, enabled: boolean) => void;
  moveVisibleMode: (mode: WorkspaceMode, dir: -1 | 1) => void;
  setDefaultMode: (mode: DefaultWorkspace) => void;
  /** Remember the workspace the user switched to. Never changes `defaultMode`. */
  rememberMode: (mode: WorkspaceMode) => void;
  setLivePreview: (p: LivePreviewPreference) => void;
  setTheme: (t: ThemePreference) => void;
  resetToDefaults: () => void;
  /** Close a help tip for good (until it is reset). */
  dismissHint: (id: HintId) => void;
  /** Show every help tip again. */
  resetHints: () => void;
  setPanelPosition: (id: PanelId, position: PanelPosition) => void;
  setPanelCollapsed: (id: PanelId, collapsed: boolean) => void;
  applyLayoutPreset: (preset: Exclude<LayoutPresetId, "custom">) => void;
  /** Persist sizes the user dragged (ignored when "remember sizes" is off). */
  saveRegionSize: (position: RegionPosition, px: number) => void;
  saveStackSize: (id: PanelId, position: RegionPosition, percent: number) => void;
  setRememberSizes: (on: boolean) => void;
  setRememberCollapsed: (on: boolean) => void;
  /** Panel layout, view modes and default view back to factory settings. Unit, theme and Live Preview are kept. */
  resetWorkspace: () => void;
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
    const editLayout = (f: (l: WorkspaceLayoutPrefs) => WorkspaceLayoutPrefs) =>
      edit((p) => ({ ...p, workspace: { ...p.workspace, layout: f(p.workspace.layout) } }));
    const bumpEpoch = () => set((s) => ({ layoutEpoch: s.layoutEpoch + 1 }));

    return {
      prefs: loadPreferences(storage),
      layoutEpoch: 0,
      setUnit: (unit) => edit((p) => ({ ...p, measurement: { unit } })),
      setVisibleMode: (mode, enabled) =>
        edit((p) => ({
          ...p,
          workspace: { ...p.workspace, visibleModes: toggleMode(p.workspace.visibleModes, mode, enabled) },
        })),
      moveVisibleMode: (mode, dir) =>
        edit((p) => ({
          ...p,
          workspace: { ...p.workspace, visibleModes: moveMode(p.workspace.visibleModes, mode, dir) },
        })),
      setDefaultMode: (defaultMode) => edit((p) => ({ ...p, workspace: { ...p.workspace, defaultMode } })),
      rememberMode: (lastMode) => {
        if (get().prefs.workspace.lastMode !== lastMode)
          edit((p) => ({ ...p, workspace: { ...p.workspace, lastMode } }));
      },
      setLivePreview: (livePreview) => edit((p) => ({ ...p, preview: { livePreview } })),
      setTheme: (theme) => edit((p) => ({ ...p, appearance: { theme } })),
      resetToDefaults: () => {
        commit(DEFAULT_PREFERENCES);
        bumpEpoch();
      },
      dismissHint: (id) =>
        edit((p) => ({
          ...p,
          help: {
            dismissedHints: p.help.dismissedHints.includes(id) ? p.help.dismissedHints : [...p.help.dismissedHints, id],
          },
        })),
      resetHints: () => edit((p) => ({ ...p, help: { dismissedHints: [] } })),
      setPanelPosition: (id, position) => editLayout((l) => setPanelPosition(l, id, position)),
      setPanelCollapsed: (id, collapsed) => editLayout((l) => setPanelCollapsed(l, id, collapsed)),
      applyLayoutPreset: (preset) => {
        editLayout((l) => applyPreset(l, preset));
        bumpEpoch();
      },
      saveRegionSize: (position, px) => {
        const l = get().prefs.workspace.layout;
        if (l.rememberSizes && l.regionSizes[position] !== Math.round(px)) {
          editLayout((x) => ({ ...x, regionSizes: { ...x.regionSizes, [position]: Math.round(px) } }));
        }
      },
      saveStackSize: (id, position, percent) => {
        if (!get().prefs.workspace.layout.rememberSizes) return;
        editLayout((l) => ({
          ...l,
          panels: l.panels.map((p) => (p.id === id ? { ...p, stackSize: { ...p.stackSize, [position]: percent } } : p)),
        }));
      },
      setRememberSizes: (rememberSizes) => editLayout((l) => ({ ...l, rememberSizes })),
      setRememberCollapsed: (rememberCollapsed) => editLayout((l) => ({ ...l, rememberCollapsed })),
      resetWorkspace: () => {
        edit((p) => ({
          ...p,
          workspace: { ...DEFAULT_PREFERENCES.workspace, layout: defaultLayout() },
        }));
        bumpEpoch();
      },
    };
  });
}

export const usePreferencesStore = createPreferencesStore(browserStorage());

/** Unit currently chosen for displaying/typing measurements. */
export const useUnit = () => usePreferencesStore((s) => s.prefs.measurement.unit);

/** Whether tip `id` should be shown, and how to close it. */
export function useHint(id: HintId) {
  const dismissed = usePreferencesStore((s) => s.prefs.help.dismissedHints.includes(id));
  const dismissHint = usePreferencesStore((s) => s.dismissHint);
  return { visible: !dismissed, dismiss: () => dismissHint(id) };
}
