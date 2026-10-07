// Application preferences: how the app behaves for this user. Deliberately
// separate from document settings (card size, gaps, page, margins), which live in
// the layout store and never become global preferences.
//
// One versioned model. `normalizePreferences` is the only way raw data
// (storage, tests, future imports) becomes an `AppPreferences`: it merges onto
// the defaults, drops invalid values and repairs invariants, so the rest of the
// app never sees an invalid state.

import { type HintId, isHintId } from "./hints";
import { MEASUREMENT_UNITS, type MeasurementUnit } from "./measurement";
import { defaultLayout, normalizeLayout, type WorkspaceLayoutPrefs } from "./workspace-layout";

// v2: adds workspace.layout (panel positions/sizes). v3: adds help.dismissedHints. v4: adds
// inspector.sections and print.layout. Older files migrate by taking the defaults of what they lack.
export const PREFERENCES_VERSION = 4;

export type WorkspaceMode = "source" | "output" | "split";
/** Canonical order, also the priority used to pick a fallback default. */
export const WORKSPACE_MODES: WorkspaceMode[] = ["source", "output", "split"];
export const WORKSPACE_LABEL: Record<WorkspaceMode, string> = { source: "Source", output: "Output", split: "Split" };

/** A fixed mode, or "last" = reopen whichever workspace was used last. */
export type DefaultWorkspace = WorkspaceMode | "last";
export type LivePreviewPreference = "always" | "manual";
export type ThemePreference = "system" | "light" | "dark";
export const THEMES: ThemePreference[] = ["system", "light", "dark"];

export interface AppPreferences {
  version: number;
  measurement: { unit: MeasurementUnit };
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
    /** Tips the user has closed; they stay hidden until "Reset help tips". */
    dismissedHints: HintId[];
  };
  inspector: {
    /** Collapsible inspector sections the user opened (true) or closed (false); missing = the section's default. */
    sections: Record<string, boolean>;
  };
  print: {
    /** The Print stage's own layout: widths in px of the card library and of the inspector. */
    layout: PrintLayoutPrefs;
  };
}

export interface PrintLayoutPrefs {
  libraryWidth: number;
  inspectorWidth: number;
}

export const DEFAULT_PRINT_LAYOUT: PrintLayoutPrefs = { libraryWidth: 320, inspectorWidth: 300 };
export const PRINT_PANEL_LIMITS = { min: 200, max: 700 };

/** Most open/closed states remembered; section ids are short fixed names, so this is generous. */
const MAX_SECTIONS = 64;

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: PREFERENCES_VERSION,
  measurement: { unit: "mm" },
  workspace: { visibleModes: [...WORKSPACE_MODES], defaultMode: "source", lastMode: "source", layout: defaultLayout() },
  preview: { livePreview: "manual" },
  appearance: { theme: "system" },
  help: { dismissedHints: [] },
  inspector: { sections: {} },
  print: { layout: { ...DEFAULT_PRINT_LAYOUT } },
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

const width = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(Math.max(v, PRINT_PANEL_LIMITS.min), PRINT_PANEL_LIMITS.max))
    : fallback;

/**
 * Raw (possibly partial, stale, hand-edited or corrupt) data -> valid preferences.
 * Unknown fields are dropped, missing ones take their default, so a newer
 * version's added setting simply appears with its default for existing users.
 */
export function normalizePreferences(raw: unknown): AppPreferences {
  const d = DEFAULT_PREFERENCES;
  const r = isObj(raw) ? raw : {};
  const m = isObj(r.measurement) ? r.measurement : {};
  const w = isObj(r.workspace) ? r.workspace : {};
  const p = isObj(r.preview) ? r.preview : {};
  const a = isObj(r.appearance) ? r.appearance : {};
  const h = isObj(r.help) ? r.help : {};
  const ins = isObj(r.inspector) ? r.inspector : {};
  const pr = isObj(r.print) ? r.print : {};
  const pl = isObj(pr.layout) ? pr.layout : {};

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

  return {
    version: PREFERENCES_VERSION,
    measurement: { unit: oneOf(m.unit, MEASUREMENT_UNITS, d.measurement.unit) },
    workspace: { visibleModes, defaultMode, lastMode, layout: normalizeLayout(w.layout) },
    preview: { livePreview: oneOf(p.livePreview, ["always", "manual"] as const, d.preview.livePreview) },
    appearance: { theme: oneOf(a.theme, THEMES, d.appearance.theme) },
    help: {
      // Known ids only, no duplicates (a removed/renamed tip's old id is simply dropped).
      dismissedHints: Array.isArray(h.dismissedHints)
        ? [...new Set(h.dismissedHints.filter(isHintId))]
        : d.help.dismissedHints,
    },
    inspector: { sections: normalizeSections(ins.sections) },
    print: {
      layout: {
        libraryWidth: width(pl.libraryWidth, d.print.layout.libraryWidth),
        inspectorWidth: width(pl.inspectorWidth, d.print.layout.inspectorWidth),
      },
    },
  };
}

/** Upgrade stored data written by an older app version. v1 is current, so this normalizes. */
export function migratePreferences(raw: unknown): AppPreferences {
  // Older versions need nothing extra: a missing `workspace.layout` (v1) or `help` (v1/v2)
  // is filled with its default while every other setting is kept.
  // Future: `if (version < 4) raw = { ...raw, editor: {...} }` before normalizing.
  return normalizePreferences(raw);
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
