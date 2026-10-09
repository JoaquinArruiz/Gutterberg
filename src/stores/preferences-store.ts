import { create } from "zustand";
import { applyLocale } from "../i18n";
import type { AiProvider, AiProviderSettings } from "../lib/ai";
import { type HintId, hintVersion } from "../lib/hints";
import { type DecimalPreference, type LanguagePreference, resolveLanguage, resolveSeparator } from "../lib/locale";
import type { MeasurementUnit } from "../lib/measurement";
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  type DefaultWorkspace,
  type GridPreset,
  type ImageSizePrefs,
  type LivePreviewPreference,
  migratePreferences,
  moveMode,
  normalizePreferences,
  type ThemePreference,
  toggleMode,
  type WorkspaceMode,
} from "../lib/preferences";
import type { PendingUpdate, UpdateNotify } from "../lib/updates";
import {
  applyPreset,
  defaultLayout,
  type LayoutId,
  type LayoutPresetId,
  layoutOfPanel,
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

export const PREFERENCES_KEY = "gutterberg:preferences";
/** The key used before the app was renamed to Gutterberg; read once, then removed. */
export const LEGACY_PREFERENCES_KEY = "pdf-card-editor:preferences";

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

/** What a layout restores when "remember ..." is off: the sizes and the collapsed panels are not brought back. */
function forgetUnremembered(l: WorkspaceLayoutPrefs): WorkspaceLayoutPrefs {
  return {
    ...l,
    regionSizes: l.rememberSizes ? l.regionSizes : {},
    panels: l.panels.map(({ stackSize, collapsed, ...p }) => ({
      ...p,
      ...(l.rememberSizes && stackSize ? { stackSize } : {}),
      ...(l.rememberCollapsed && collapsed ? { collapsed } : {}),
    })),
  };
}

/**
 * Load -> validate -> migrate -> merge with defaults. Never throws; corrupt data yields defaults.
 * "Remember ..." switches are honoured here: when off, the saved sizes / collapsed state are not restored.
 */
export function loadPreferences(storage: KeyValueStorage): AppPreferences {
  try {
    let text = storage.getItem(PREFERENCES_KEY);
    if (!text) {
      const legacy = storage.getItem(LEGACY_PREFERENCES_KEY);
      if (legacy) {
        text = legacy;
        storage.setItem(PREFERENCES_KEY, legacy);
        storage.removeItem(LEGACY_PREFERENCES_KEY);
      }
    }
    if (!text) return DEFAULT_PREFERENCES;
    const prefs = migratePreferences(JSON.parse(text));
    return {
      ...prefs,
      workspace: { ...prefs.workspace, layout: forgetUnremembered(prefs.workspace.layout) },
      print: { layout: forgetUnremembered(prefs.print.layout) },
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
  /** The welcome tour of this version was closed: it does not open by itself again. */
  setWelcomeSeen: (version: number) => void;
  /** Remember that inspector section `id` was opened or closed. */
  setSectionOpen: (id: string, open: boolean) => void;
  /** A project file was opened or saved: it goes to the top of the recent list. */
  addRecentProject: (path: string) => void;
  /** The file is gone: drop it from the recent list. */
  removeRecentProject: (path: string) => void;
  /** The size an import used, remembered for the next one. */
  setImageSize: (size: ImageSizePrefs) => void;
  /** Saves a grid under its name, replacing a preset of the same name. */
  /** AI Mode on or off. */
  setAiEnabled: (enabled: boolean) => void;
  setAiProvider: (provider: AiProvider) => void;
  setAiSendImages: (on: boolean) => void;
  /** The model and address typed for one provider. */
  setAiProviderSettings: (provider: AiProvider, patch: Partial<AiProviderSettings>) => void;
  setUpdateNotify: (notify: UpdateNotify) => void;
  /** The automatic or manual check just asked for a newer version. */
  setLastCheck: (at: number) => void;
  /** "Skip this version": no toast for it, only for a newer one. */
  skipVersion: (version: string) => void;
  /** The update being installed (or nothing, once the next start has told the user how it went). */
  setPendingUpdate: (pending: PendingUpdate | null) => void;
  setLastRunVersion: (version: string) => void;
  setExperimental: (id: string, on: boolean) => void;
  savePreset: (preset: GridPreset) => void;
  deletePreset: (name: string) => void;
  setPanelPosition: (id: PanelId, position: PanelPosition) => void;
  setPanelCollapsed: (id: PanelId, collapsed: boolean) => void;
  /** The preset applies to one tab's layout. */
  applyLayoutPreset: (layout: LayoutId, preset: Exclude<LayoutPresetId, "custom">) => void;
  /** Persist sizes the user dragged in one tab's layout (ignored when "remember sizes" is off). */
  saveRegionSize: (layout: LayoutId, position: RegionPosition, px: number) => void;
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
    // The Source tab's layout lives in `workspace`, the Print tab's in `print`.
    const editLayout = (layout: LayoutId, f: (l: WorkspaceLayoutPrefs) => WorkspaceLayoutPrefs) =>
      edit((p) =>
        layout === "cards"
          ? { ...p, workspace: { ...p.workspace, layout: f(p.workspace.layout) } }
          : { ...p, print: { layout: f(p.print.layout) } },
      );
    const layoutOf = (layout: LayoutId) =>
      layout === "cards" ? get().prefs.workspace.layout : get().prefs.print.layout;
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
        // Recent projects, saved grids and the last image size are the user's own data, not settings: they stay.
        commit({
          ...DEFAULT_PREFERENCES,
          files: get().prefs.files,
          presets: get().prefs.presets,
          images: get().prefs.images,
          help: { ...DEFAULT_PREFERENCES.help, welcomeSeen: get().prefs.help.welcomeSeen },
          // The record of checks and of an update being installed is not a setting; only "Tell me about" starts over.
          updates: { ...get().prefs.updates, notify: DEFAULT_PREFERENCES.updates.notify },
        });
        bumpEpoch();
      },
      dismissHint: (id) => {
        if ((get().prefs.help.dismissedHints[id] ?? 0) < hintVersion(id))
          edit((p) => ({
            ...p,
            help: { ...p.help, dismissedHints: { ...p.help.dismissedHints, [id]: hintVersion(id) } },
          }));
      },
      resetHints: () => edit((p) => ({ ...p, help: { ...p.help, dismissedHints: {} } })),
      setWelcomeSeen: (version) => edit((p) => ({ ...p, help: { ...p.help, welcomeSeen: version } })),
      setSectionOpen: (id, open) => {
        if (get().prefs.inspector.sections[id] !== open)
          edit((p) => ({ ...p, inspector: { sections: { ...p.inspector.sections, [id]: open } } }));
      },
      addRecentProject: (path) =>
        edit((p) => ({ ...p, files: { recent: [path, ...p.files.recent.filter((x) => x !== path)] } })),
      removeRecentProject: (path) =>
        edit((p) => ({ ...p, files: { recent: p.files.recent.filter((x) => x !== path) } })),
      setImageSize: (size) => edit((p) => ({ ...p, images: { size } })),
      setAiEnabled: (enabled) => edit((p) => ({ ...p, ai: { ...p.ai, enabled } })),
      setAiProvider: (provider) => edit((p) => ({ ...p, ai: { ...p.ai, provider } })),
      setAiSendImages: (sendImages) => edit((p) => ({ ...p, ai: { ...p.ai, sendImages } })),
      setAiProviderSettings: (provider, patch) =>
        edit((p) => ({
          ...p,
          ai: { ...p.ai, providers: { ...p.ai.providers, [provider]: { ...p.ai.providers[provider], ...patch } } },
        })),
      setUpdateNotify: (notify) => edit((p) => ({ ...p, updates: { ...p.updates, notify } })),
      setLastCheck: (lastCheck) => edit((p) => ({ ...p, updates: { ...p.updates, lastCheck } })),
      skipVersion: (skippedVersion) => edit((p) => ({ ...p, updates: { ...p.updates, skippedVersion } })),
      setPendingUpdate: (pending) => edit((p) => ({ ...p, updates: { ...p.updates, pending } })),
      setLastRunVersion: (lastRunVersion) => {
        if (get().prefs.updates.lastRunVersion !== lastRunVersion)
          edit((p) => ({ ...p, updates: { ...p.updates, lastRunVersion } }));
      },
      setExperimental: (id, on) =>
        edit((p) => ({ ...p, experimental: { flags: { ...p.experimental.flags, [id]: on } } })),
      savePreset: (preset) =>
        edit((p) => {
          const same = (a: GridPreset) => a.name.trim().toLowerCase() === preset.name.trim().toLowerCase();
          const at = p.presets.findIndex(same);
          const presets = at === -1 ? [...p.presets, preset] : p.presets.map((x, i) => (i === at ? preset : x));
          return { ...p, presets };
        }),
      deletePreset: (name) => edit((p) => ({ ...p, presets: p.presets.filter((x) => x.name !== name) })),
      setPanelPosition: (id, position) => editLayout(layoutOfPanel(id), (l) => setPanelPosition(l, id, position)),
      setPanelCollapsed: (id, collapsed) => editLayout(layoutOfPanel(id), (l) => setPanelCollapsed(l, id, collapsed)),
      applyLayoutPreset: (layout, preset) => {
        editLayout(layout, (l) => applyPreset(l, preset));
        bumpEpoch();
      },
      saveRegionSize: (layout, position, px) => {
        const l = layoutOf(layout);
        if (l.rememberSizes && l.regionSizes[position] !== Math.round(px)) {
          editLayout(layout, (x) => ({ ...x, regionSizes: { ...x.regionSizes, [position]: Math.round(px) } }));
        }
      },
      saveStackSize: (id, position, percent) => {
        const layout = layoutOfPanel(id);
        if (!layoutOf(layout).rememberSizes) return;
        editLayout(layout, (l) => ({
          ...l,
          panels: l.panels.map((p) => (p.id === id ? { ...p, stackSize: { ...p.stackSize, [position]: percent } } : p)),
        }));
      },
      // The two switches are one setting for both tabs (normalization copies the Source tab's onto the Print tab's).
      setRememberSizes: (rememberSizes) => editLayout("cards", (l) => ({ ...l, rememberSizes })),
      setRememberCollapsed: (rememberCollapsed) => editLayout("cards", (l) => ({ ...l, rememberCollapsed })),
      resetWorkspace: () => {
        edit((p) => ({
          ...p,
          workspace: { ...DEFAULT_PREFERENCES.workspace, layout: defaultLayout() },
          print: { layout: defaultLayout("print") },
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

/** Whether the user switched the experimental feature `id` on (`src/lib/experimental.ts` lists them). */
export const useExperimental = (id: string): boolean =>
  usePreferencesStore((s) => s.prefs.experimental.flags[id] === true);
