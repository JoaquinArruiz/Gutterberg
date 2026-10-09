// Application preferences: how the app behaves for this user. Deliberately
// separate from document settings (card size, gaps, page, margins), which live in
// the layout store and never become global preferences.
//
// One versioned model. `normalizePreferences` is the only way raw data
// (storage, tests, future imports) becomes an `AppPreferences`: it merges onto
// the defaults, drops invalid values and repairs invariants, so the rest of the
// app never sees an invalid state.

import { type AiPrefs, DEFAULT_AI, normalizeAi } from "./ai";
import { MAX_GAP_MM } from "./document-layout";
import { normalizeExperimental } from "./experimental";
import { clampCount } from "./grid";
import { type HintId, isHintId } from "./hints";
import { DECIMAL_PREFERENCES, type DecimalPreference, LANGUAGE_PREFERENCES, type LanguagePreference } from "./locale";
import { MEASUREMENT_UNITS, type MeasurementUnit } from "./measurement";
import { DEFAULT_UPDATES, normalizeUpdates, type UpdatePrefs } from "./updates";
import { defaultLayout, normalizeLayout, type RegionPosition, type WorkspaceLayoutPrefs } from "./workspace-layout";

// v2: adds workspace.layout (panel positions/sizes). v3: adds help.dismissedHints. v4: adds
// inspector.sections and print.layout. v5: help.dismissedHints is { id: version } (was a list). v6: adds
// locale (language and decimal separator, both defaulting to following the system). v7: adds files.recent
// (recent projects) and presets (named grids). v8: adds ai (AI Mode: off by default; never a key). v9: the Print tab's
// layout is a panel layout like the Source tab's (print.layout was { libraryWidth, inspectorWidth }; those widths become
// the sizes of its left and right regions). v10: adds help.welcomeSeen (the version of the welcome tour the user has
// seen or skipped). v11: adds updates (what to be told about, the last check, the version being installed) and
// experimental (the switches of unfinished features). Older files migrate by taking the defaults of what they lack.
export const PREFERENCES_VERSION = 11;

export type WorkspaceMode = "source" | "output" | "split";
/** Canonical order, also the priority used to pick a fallback default. */
export const WORKSPACE_MODES: WorkspaceMode[] = ["source", "output", "split"];

/** A fixed mode, or "last" = reopen whichever workspace was used last. */
export type DefaultWorkspace = WorkspaceMode | "last";
export type LivePreviewPreference = "always" | "manual";
export type ThemePreference = "system" | "light" | "dark";
export const THEMES: ThemePreference[] = ["system", "light", "dark"];

export interface LocalePrefs {
  language: LanguagePreference;
  decimal: DecimalPreference;
}

/** A named grid and source gap, saved to apply to any page group ("3×3 poker, 0 mm"). */
export interface GridPreset {
  name: string;
  rows: number;
  columns: number;
  sourceGapXMm: number;
  sourceGapYMm: number;
  sourceGapLinked: boolean;
}

export const MAX_PRESETS = 50;
export const MAX_PRESET_NAME = 60;
export const MAX_RECENT_PROJECTS = 8;

export interface AppPreferences {
  version: number;
  measurement: { unit: MeasurementUnit };
  locale: LocalePrefs;
  workspace: {
    /** Ordered: this is exactly the order of the toolbar switcher. */
    visibleModes: WorkspaceMode[];
    defaultMode: DefaultWorkspace;
    /** Last workspace the user switched to (used when `defaultMode` is "last"). */
    lastMode: WorkspaceMode;
    /** Where the Pages/Properties panels sit, and their remembered sizes. */
    layout: WorkspaceLayoutPrefs;
  };
  preview: { livePreview: LivePreviewPreference };
  appearance: { theme: ThemePreference };
  help: {
    /** Tips the user has closed, with the hint version they closed; hidden until "Reset help tips". */
    dismissedHints: Partial<Record<HintId, number>>;
    /** The welcome tour's version that was closed (seen, skipped or finished); 0 = never shown (M25). */
    welcomeSeen: number;
  };
  inspector: {
    /** Collapsible inspector sections the user opened (true) or closed (false); missing = the section's default. */
    sections: Record<string, boolean>;
  };
  print: {
    /** The Print tab's own panel layout (piece library and settings around the sheets), separate from the Source tab's. */
    layout: WorkspaceLayoutPrefs;
  };
  files: {
    /** Project files opened or saved lately, newest first. */
    recent: string[];
  };
  /** Saved grids, in the order they were made. */
  presets: GridPreset[];
  /** Images as pieces (M24). */
  images: { size: ImageSizePrefs };
  /** AI Mode (M19). */
  ai: AiPrefs;
  /** Checking for and installing new versions (M15). */
  updates: UpdatePrefs;
  /** Switches of unfinished features, by id; off unless set (M15). */
  experimental: { flags: Record<string, boolean> };
}

/** The size the last import used, offered again by the next one (M24). */
export type ImageSizePrefs = {
  preset: "standard" | "small" | "tarot" | "image" | "custom";
  widthMm: number;
  heightMm: number;
  /** The images include bleed, and how much. */
  bleed: boolean;
  bleedMm: number;
};

export const DEFAULT_IMAGE_SIZE: ImageSizePrefs = {
  preset: "standard",
  widthMm: 63,
  heightMm: 88,
  bleed: false,
  bleedMm: 3,
};

const IMAGE_SIZE_PRESETS = ["standard", "small", "tarot", "image", "custom"] as const;

function normalizeImageSize(raw: unknown): ImageSizePrefs {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_IMAGE_SIZE;
  const mm = (v: unknown, fallback: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
  return {
    preset: oneOf(r.preset, IMAGE_SIZE_PRESETS, d.preset),
    widthMm: mm(r.widthMm, d.widthMm, 5, 1000),
    heightMm: mm(r.heightMm, d.heightMm, 5, 1000),
    bleed: typeof r.bleed === "boolean" ? r.bleed : d.bleed,
    bleedMm: mm(r.bleedMm, d.bleedMm, 0, 20),
  };
}

/** Most open/closed states remembered; section ids are short fixed names, so this is generous. */
const MAX_SECTIONS = 64;

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: PREFERENCES_VERSION,
  measurement: { unit: "mm" },
  locale: { language: "system", decimal: "auto" },
  workspace: { visibleModes: [...WORKSPACE_MODES], defaultMode: "source", lastMode: "source", layout: defaultLayout() },
  preview: { livePreview: "manual" },
  appearance: { theme: "system" },
  help: { dismissedHints: {}, welcomeSeen: 0 },
  inspector: { sections: {} },
  print: { layout: defaultLayout("print") },
  files: { recent: [] },
  presets: [],
  images: { size: DEFAULT_IMAGE_SIZE },
  ai: DEFAULT_AI,
  updates: DEFAULT_UPDATES,
  experimental: { flags: {} },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMode = (v: unknown): v is WorkspaceMode => WORKSPACE_MODES.includes(v as WorkspaceMode);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** First mode from `WORKSPACE_MODES` priority that is visible. */
export const fallbackMode = (visible: WorkspaceMode[]): WorkspaceMode =>
  WORKSPACE_MODES.find((m) => visible.includes(m)) ?? WORKSPACE_MODES[0];

/** Section ids with a boolean state; anything else is dropped. */
function normalizeSections(raw: unknown): Record<string, boolean> {
  if (!isObj(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, open] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_SECTIONS) break;
    if (typeof open === "boolean" && id.length > 0 && id.length <= 40) out[id] = open;
  }
  return out;
}

/**
 * Known hint ids with a version (a removed or renamed tip's old id is dropped). Before v5 this was a
 * list of ids, each counting as version 1; the shared `live-preview-manual` tip was later split in two,
 * so closing it closes both halves.
 */
function normalizeDismissed(raw: unknown): Partial<Record<HintId, number>> {
  const entries: [unknown, unknown][] = Array.isArray(raw)
    ? raw.map((id) => [id, 1])
    : isObj(raw)
      ? Object.entries(raw)
      : [];
  const out: Partial<Record<HintId, number>> = {};
  for (const [id, version] of entries) {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) continue;
    const ids = id === "live-preview-manual" ? ["live-preview-output", "live-preview-sheets"] : [id];
    for (const k of ids) if (isHintId(k)) out[k] = Math.max(out[k] ?? 0, version);
  }
  return out;
}

/** Paths of project files: non-empty text, no repeats, newest first, a short list. */
function normalizeRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p === "string" && p.length > 0 && p.length <= 1024 && !out.includes(p)) out.push(p);
    if (out.length >= MAX_RECENT_PROJECTS) break;
  }
  return out;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const gap = (v: unknown) => Math.min(Math.max(num(v, 0), 0), MAX_GAP_MM);

/** Presets with a name and a grid inside what the UI allows; a repeated name keeps its first entry. */
function normalizePresets(raw: unknown): GridPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: GridPreset[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.name !== "string") continue;
    const name = p.name.trim().slice(0, MAX_PRESET_NAME);
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    const linked = typeof p.sourceGapLinked === "boolean" ? p.sourceGapLinked : true;
    const sourceGapXMm = gap(p.sourceGapXMm);
    out.push({
      name,
      rows: clampCount(num(p.rows, 1)),
      columns: clampCount(num(p.columns, 1)),
      sourceGapXMm,
      sourceGapYMm: linked ? sourceGapXMm : gap(p.sourceGapYMm),
      sourceGapLinked: linked,
    });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

/**
 * Raw (possibly partial, stale, hand-edited or corrupt) data -> valid preferences.
 * Unknown fields are dropped, missing ones take their default, so a newer
 * version's added setting simply appears with its default for existing users.
 */
export function normalizePreferences(raw: unknown): AppPreferences {
  const d = DEFAULT_PREFERENCES;
  const r = isObj(raw) ? raw : {};
  const m = isObj(r.measurement) ? r.measurement : {};
  const loc = isObj(r.locale) ? r.locale : {};
  const w = isObj(r.workspace) ? r.workspace : {};
  const p = isObj(r.preview) ? r.preview : {};
  const a = isObj(r.appearance) ? r.appearance : {};
  const h = isObj(r.help) ? r.help : {};
  const ins = isObj(r.inspector) ? r.inspector : {};
  const pr = isObj(r.print) ? r.print : {};
  const fl = isObj(r.files) ? r.files : {};

  // Visible modes: valid, de-duplicated, order kept. Never empty.
  const seen = new Set<WorkspaceMode>();
  const listed = Array.isArray(w.visibleModes) ? w.visibleModes.filter(isMode) : [];
  const visibleModes = listed.filter((x) => !seen.has(x) && seen.add(x));
  if (visibleModes.length === 0) visibleModes.push(...d.workspace.visibleModes);

  const wantedDefault = w.defaultMode === "last" ? "last" : w.defaultMode;
  const defaultMode: DefaultWorkspace =
    wantedDefault === "last" || (isMode(wantedDefault) && visibleModes.includes(wantedDefault))
      ? (wantedDefault as DefaultWorkspace)
      : fallbackMode(visibleModes);
  const lastMode = isMode(w.lastMode) && visibleModes.includes(w.lastMode) ? w.lastMode : visibleModes[0];
  const sourceLayout = normalizeLayout(w.layout);

  return {
    version: PREFERENCES_VERSION,
    measurement: { unit: oneOf(m.unit, MEASUREMENT_UNITS, d.measurement.unit) },
    locale: {
      language: oneOf(loc.language, LANGUAGE_PREFERENCES, d.locale.language),
      decimal: oneOf(loc.decimal, DECIMAL_PREFERENCES, d.locale.decimal),
    },
    workspace: { visibleModes, defaultMode, lastMode, layout: sourceLayout },
    preview: { livePreview: oneOf(p.livePreview, ["always", "manual"] as const, d.preview.livePreview) },
    appearance: { theme: oneOf(a.theme, THEMES, d.appearance.theme) },
    help: {
      dismissedHints: normalizeDismissed(h.dismissedHints),
      welcomeSeen:
        typeof h.welcomeSeen === "number" && Number.isInteger(h.welcomeSeen) && h.welcomeSeen > 0 ? h.welcomeSeen : 0,
    },
    inspector: { sections: normalizeSections(ins.sections) },
    // The two "remember" switches are one setting for both tabs: the Source tab's copy is the one the user sets.
    print: {
      layout: {
        ...normalizeLayout(pr.layout, "print"),
        rememberSizes: sourceLayout.rememberSizes,
        rememberCollapsed: sourceLayout.rememberCollapsed,
      },
    },
    files: { recent: normalizeRecent(fl.recent) },
    presets: normalizePresets(r.presets),
    images: { size: normalizeImageSize(isObj(r.images) ? r.images.size : undefined) },
    ai: normalizeAi(r.ai),
    updates: normalizeUpdates(r.updates),
    experimental: { flags: normalizeExperimental(isObj(r.experimental) ? r.experimental.flags : undefined) },
  };
}

/**
 * Before v9 the Print tab's layout was two widths. They become the sizes of its left (piece library) and right
 * (settings) regions; the panels start where they always were.
 */
function migratePrintLayout(raw: Record<string, unknown>): Record<string, unknown> {
  const print = isObj(raw.print) ? raw.print : {};
  const old = isObj(print.layout) ? print.layout : {};
  if (!("libraryWidth" in old || "inspectorWidth" in old)) return raw;
  const regionSizes: Partial<Record<RegionPosition, number>> = {};
  if (typeof old.libraryWidth === "number") regionSizes.left = old.libraryWidth;
  if (typeof old.inspectorWidth === "number") regionSizes.right = old.inspectorWidth;
  return { ...raw, print: { ...print, layout: { ...defaultLayout("print"), regionSizes } } };
}

/** Upgrade stored data written by an older app version, then normalize it (what it lacks takes its default). */
export function migratePreferences(raw: unknown): AppPreferences {
  // A missing `workspace.layout` (v1) or `help` (v1/v2) is filled with its default while every other setting is kept.
  const current = isObj(raw) && typeof raw.version === "number" && raw.version >= 9;
  return normalizePreferences(isObj(raw) && !current ? migratePrintLayout(raw) : raw);
}

/** Workspace a new editor session opens in. */
export function resolveStartMode(prefs: AppPreferences): WorkspaceMode {
  const { visibleModes, defaultMode, lastMode } = prefs.workspace;
  const wanted = defaultMode === "last" ? lastMode : defaultMode;
  return visibleModes.includes(wanted) ? wanted : fallbackMode(visibleModes);
}

/** Per-session values a new editor starts from. Toggling them later does not touch preferences. */
export function sessionDefaults(prefs: AppPreferences) {
  return { viewMode: resolveStartMode(prefs), live: prefs.preview.livePreview === "always" };
}

/** Enable/disable `mode`, refusing to remove the last one. New modes keep canonical order. */
export function toggleMode(visible: WorkspaceMode[], mode: WorkspaceMode, enabled: boolean): WorkspaceMode[] {
  if (!enabled) return visible.length > 1 ? visible.filter((m) => m !== mode) : visible;
  if (visible.includes(mode)) return visible;
  const at = visible.findIndex((m) => WORKSPACE_MODES.indexOf(m) > WORKSPACE_MODES.indexOf(mode));
  return at === -1 ? [...visible, mode] : [...visible.slice(0, at), mode, ...visible.slice(at)];
}

/** Move `mode` one place earlier (-1) or later (+1). */
export function moveMode(visible: WorkspaceMode[], mode: WorkspaceMode, dir: -1 | 1): WorkspaceMode[] {
  const i = visible.indexOf(mode);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= visible.length) return visible;
  const next = [...visible];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
