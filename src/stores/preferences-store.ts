import { create } from "zustand";
import { applyLocale } from "../i18n";
import type { AiProvider, AiProviderSettings } from "../lib/ai";
import { type HintId, hintVersion } from "../lib/hints";
import { type DecimalPreference, type LanguagePreference, resolveLanguage, resolveSeparator } from "../lib/locale";
import type { MeasurementUnit } from "../lib/measurement";
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  DEFAULT_PRINT_LAYOUT,
  type DefaultWorkspace,
  type GridPreset,
  type LivePreviewPreference,
  migratePreferences,
  moveMode,
  normalizePreferences,
  type PrintLayoutPrefs,
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
    return {
      ...prefs,
      workspace: { ...prefs.workspace, layout },
      print: l.rememberSizes ? prefs.print : DEFAULT_PREFERENCES.print,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

type PreferencesState = {
  prefs: AppPreferences;
  /** Bumped when sizes are reset so resizable groups remount with the new defaults. Not persisted. */
  layoutEpoch: number;
  setUnit: (unit: MeasurementUnit) => void;
  setLanguage: (language: LanguagePreference) => void;
  setDecimal: (decimal: DecimalPreference) => void;
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
  /** Remember that inspector section `id` was opened or closed. */
  setSectionOpen: (id: string, open: boolean) => void;
  /** A project file was opened or saved: it goes to the top of the recent list. */
  addRecentProject: (path: string) => void;
  /** The file is gone: drop it from the recent list. */
  removeRecentProject: (path: string) => void;
  /** Saves a grid under its name, replacing a preset of the same name. */
  /** AI Mode on or off. */
  setAiEnabled: (enabled: boolean) => void;
  setAiProvider: (provider: AiProvider) => void;
  setAiSendImages: (on: boolean) => void;
  /** The model and address typed for one provider. */
  setAiProviderSettings: (provider: AiProvider, patch: Partial<AiProviderSettings>) => void;
  savePreset: (preset: GridPreset) => void;
  deletePreset: (name: string) => void;
  /** Persist the widths the user dragged in the Print stage. */
  savePrintLayout: (layout: Partial<PrintLayoutPrefs>) => void;
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
      applyLocale(prefs.locale);
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

    const prefs = loadPreferences(storage);
    applyLocale(prefs.locale);
    return {
      prefs,
      layoutEpoch: 0,
      setUnit: (unit) => edit((p) => ({ ...p, measurement: { unit } })),
      setLanguage: (language) => edit((p) => ({ ...p, locale: { ...p.locale, language } })),
      setDecimal: (decimal) => edit((p) => ({ ...p, locale: { ...p.locale, decimal } })),
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
        // Recent projects and saved grids are the user's own data, not settings: they stay.
        commit({ ...DEFAULT_PREFERENCES, files: get().prefs.files, presets: get().prefs.presets });
        bumpEpoch();
      },
      dismissHint: (id) => {
        if ((get().prefs.help.dismissedHints[id] ?? 0) < hintVersion(id))
          edit((p) => ({ ...p, help: { dismissedHints: { ...p.help.dismissedHints, [id]: hintVersion(id) } } }));
      },
      resetHints: () => edit((p) => ({ ...p, help: { dismissedHints: {} } })),
      setSectionOpen: (id, open) => {
        if (get().prefs.inspector.sections[id] !== open)
          edit((p) => ({ ...p, inspector: { sections: { ...p.inspector.sections, [id]: open } } }));
      },
      addRecentProject: (path) =>
        edit((p) => ({ ...p, files: { recent: [path, ...p.files.recent.filter((x) => x !== path)] } })),
      removeRecentProject: (path) =>
        edit((p) => ({ ...p, files: { recent: p.files.recent.filter((x) => x !== path) } })),
      setAiEnabled: (enabled) => edit((p) => ({ ...p, ai: { ...p.ai, enabled } })),
      setAiProvider: (provider) => edit((p) => ({ ...p, ai: { ...p.ai, provider } })),
      setAiSendImages: (sendImages) => edit((p) => ({ ...p, ai: { ...p.ai, sendImages } })),
      setAiProviderSettings: (provider, patch) =>
        edit((p) => ({
          ...p,
          ai: { ...p.ai, providers: { ...p.ai.providers, [provider]: { ...p.ai.providers[provider], ...patch } } },
        })),
      savePreset: (preset) =>
        edit((p) => {
          const same = (a: GridPreset) => a.name.trim().toLowerCase() === preset.name.trim().toLowerCase();
          const at = p.presets.findIndex(same);
          const presets = at === -1 ? [...p.presets, preset] : p.presets.map((x, i) => (i === at ? preset : x));
          return { ...p, presets };
        }),
      deletePreset: (name) => edit((p) => ({ ...p, presets: p.presets.filter((x) => x.name !== name) })),
      savePrintLayout: (layout) => {
        if (!get().prefs.workspace.layout.rememberSizes) return;
        const cur = get().prefs.print.layout;
        const next = { ...cur, ...layout };
        if (next.libraryWidth !== cur.libraryWidth || next.inspectorWidth !== cur.inspectorWidth)
          edit((p) => ({ ...p, print: { layout: next } }));
      },
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
          print: { layout: { ...DEFAULT_PRINT_LAYOUT } },
        }));
        bumpEpoch();
      },
    };
  });
}

export const usePreferencesStore = createPreferencesStore(browserStorage());

/** The decimal separator numbers are shown with (the setting, or the language's own for Automatic). */
export const useDecimalSeparator = () =>
  usePreferencesStore((s) => resolveSeparator(s.prefs.locale.decimal, resolveLanguage(s.prefs.locale.language)));

/**
 * Unit currently chosen for displaying/typing measurements. It also follows the decimal separator, so
 * every component that formats a measurement redraws when that setting changes.
 */
export const useUnit = () => {
  useDecimalSeparator();
  return usePreferencesStore((s) => s.prefs.measurement.unit);
};
