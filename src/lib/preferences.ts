// Application preferences: how the app behaves for this user. Deliberately
// separate from document settings (card size, gaps, page, margins), which live in
// the layout store and never become global preferences.
//
// One versioned model. `normalizePreferences` is the only way raw data
// (storage, tests, future imports) becomes an `AppPreferences`: it merges onto
// the defaults, drops invalid values and repairs invariants, so the rest of the
// app never sees an invalid state.

import { MEASUREMENT_UNITS, type MeasurementUnit } from "./measurement";

export const PREFERENCES_VERSION = 1;

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
  };
  preview: { livePreview: LivePreviewPreference };
  appearance: { theme: ThemePreference };
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: PREFERENCES_VERSION,
  measurement: { unit: "mm" },
  workspace: { visibleModes: [...WORKSPACE_MODES], defaultMode: "source", lastMode: "source" },
  preview: { livePreview: "manual" },
  appearance: { theme: "system" },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMode = (v: unknown): v is WorkspaceMode => WORKSPACE_MODES.includes(v as WorkspaceMode);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** First mode from `WORKSPACE_MODES` priority that is visible. */
export const fallbackMode = (visible: WorkspaceMode[]): WorkspaceMode =>
  WORKSPACE_MODES.find((m) => visible.includes(m)) ?? WORKSPACE_MODES[0];

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
    workspace: { visibleModes, defaultMode, lastMode },
    preview: { livePreview: oneOf(p.livePreview, ["always", "manual"] as const, d.preview.livePreview) },
    appearance: { theme: oneOf(a.theme, THEMES, d.appearance.theme) },
  };
}

/** Upgrade stored data written by an older app version. v1 is current, so this normalizes. */
export function migratePreferences(raw: unknown): AppPreferences {
  // Future: `if (version < 2) raw = { ...raw, editor: {...} }` before normalizing.
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
