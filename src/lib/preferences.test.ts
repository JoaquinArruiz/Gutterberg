import { describe, expect, it } from "vitest";
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  migratePreferences,
  moveMode,
  normalizePreferences,
  resolveStartMode,
  sessionDefaults,
  toggleMode,
} from "./preferences";

const withWorkspace = (w: Partial<AppPreferences["workspace"]>): AppPreferences => ({
  ...DEFAULT_PREFERENCES,
  workspace: { ...DEFAULT_PREFERENCES.workspace, ...w },
});

describe("normalizePreferences", () => {
  it("returns the defaults for missing or garbage input", () => {
    for (const raw of [undefined, null, 5, "x", [], {}]) expect(normalizePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it("rejects an empty visibleModes list", () => {
    const p = normalizePreferences({ workspace: { visibleModes: [] } });
    expect(p.workspace.visibleModes).toEqual(["source", "output", "split"]);
  });

  it("drops unknown and duplicate modes but keeps order", () => {
    const p = normalizePreferences({
      workspace: { visibleModes: ["split", "nope", "source", "split"], defaultMode: "split" },
    });
    expect(p.workspace.visibleModes).toEqual(["split", "source"]);
  });

  it("fixes a default mode that is not visible, by source > output > split priority", () => {
    const p = normalizePreferences({ workspace: { visibleModes: ["split", "output"], defaultMode: "source" } });
    expect(p.workspace.defaultMode).toBe("output");
    const q = normalizePreferences({ workspace: { visibleModes: ["source", "output"], defaultMode: "split" } });
    expect(q.workspace.defaultMode).toBe("source");
  });

  it("accepts 'last' as the default", () => {
    expect(normalizePreferences({ workspace: { defaultMode: "last" } }).workspace.defaultMode).toBe("last");
  });

  it("repairs invalid values field by field and keeps the valid ones", () => {
    const p = normalizePreferences({
      measurement: { unit: "furlongs" },
      preview: { livePreview: "always" },
      appearance: { theme: "dark" },
    });
    expect(p.measurement.unit).toBe("mm");
    expect(p.preview.livePreview).toBe("always");
    expect(p.appearance.theme).toBe("dark");
  });
});

describe("help tips preference", () => {
  it("drops unknown or duplicate tip ids", () => {
    const p = normalizePreferences({
      help: { dismissedHints: ["live-preview-manual", "gone", "live-preview-manual", 3] },
    });
    expect(p.help.dismissedHints).toEqual(["live-preview-manual"]);
  });

  it("older preferences without `help` get an empty list and keep their settings", () => {
    const v2 = { version: 2, measurement: { unit: "cm" } };
    const p = migratePreferences(v2);
    expect(p.help.dismissedHints).toEqual([]);
    expect(p.measurement.unit).toBe("cm");
  });
});

describe("migratePreferences", () => {
  it("fills settings added in later versions without losing existing ones", () => {
    const old = { version: 1, measurement: { unit: "in" } }; // no workspace/preview/appearance yet
    const p = migratePreferences(old);
    expect(p.measurement.unit).toBe("in");
    expect(p.workspace).toEqual(DEFAULT_PREFERENCES.workspace);
    expect(p.version).toBe(DEFAULT_PREFERENCES.version);
  });
});

describe("workspace", () => {
  it("refuses to disable the last visible mode", () => {
    expect(toggleMode(["split"], "split", false)).toEqual(["split"]);
    expect(toggleMode(["source", "split"], "source", false)).toEqual(["split"]);
  });

  it("re-enabling keeps canonical order; moving reorders", () => {
    expect(toggleMode(["source", "split"], "output", true)).toEqual(["source", "output", "split"]);
    expect(moveMode(["source", "output", "split"], "split", -1)).toEqual(["source", "split", "output"]);
    expect(moveMode(["source", "split"], "source", -1)).toEqual(["source", "split"]);
  });

  it("falls back when the current default is disabled", () => {
    const visible = toggleMode(["source", "output", "split"], "split", false);
    const p = normalizePreferences(withWorkspace({ visibleModes: visible, defaultMode: "split" }));
    expect(p.workspace.defaultMode).toBe("source");
  });

  it("a new session opens in the default mode", () => {
    expect(resolveStartMode(withWorkspace({ defaultMode: "split" }))).toBe("split");
  });

  it("'last used' reopens the last workspace, but only if it is still visible", () => {
    expect(resolveStartMode(withWorkspace({ defaultMode: "last", lastMode: "output" }))).toBe("output");
    expect(
      resolveStartMode(withWorkspace({ visibleModes: ["source", "split"], defaultMode: "last", lastMode: "output" })),
    ).toBe("source");
  });
});

describe("sessionDefaults", () => {
  it("Live Preview 'always' starts on, 'manual' starts off", () => {
    expect(sessionDefaults({ ...DEFAULT_PREFERENCES, preview: { livePreview: "always" } }).live).toBe(true);
    expect(sessionDefaults({ ...DEFAULT_PREFERENCES, preview: { livePreview: "manual" } }).live).toBe(false);
  });
});

describe("inspector sections and the Print layout", () => {
  it("defaults to nothing remembered and the standard widths", () => {
    expect(DEFAULT_PREFERENCES.inspector.sections).toEqual({});
    expect(DEFAULT_PREFERENCES.print.layout).toEqual({ libraryWidth: 320, inspectorWidth: 300 });
  });

  it("keeps boolean section states and drops the rest", () => {
    const p = normalizePreferences({
      inspector: { sections: { plan: true, sheet: false, bad: "yes", n: 1, [`${"x".repeat(41)}`]: true, "": true } },
    });
    expect(p.inspector.sections).toEqual({ plan: true, sheet: false });
    expect(normalizePreferences({ inspector: { sections: [true] } }).inspector.sections).toEqual({});
    expect(normalizePreferences({ inspector: "open" }).inspector.sections).toEqual({});
  });

  it("limits how many section states are remembered", () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`s${i}`, true]));
    expect(Object.keys(normalizePreferences({ inspector: { sections: many } }).inspector.sections)).toHaveLength(64);
  });

  it("clamps Print panel widths and repairs bad ones", () => {
    const p = normalizePreferences({ print: { layout: { libraryWidth: 50, inspectorWidth: 9999 } } });
    expect(p.print.layout).toEqual({ libraryWidth: 200, inspectorWidth: 700 });
    const bad = normalizePreferences({ print: { layout: { libraryWidth: "wide", inspectorWidth: Number.NaN } } });
    expect(bad.print.layout).toEqual(DEFAULT_PREFERENCES.print.layout);
  });

  it("adds both to a version 3 file without losing what it has", () => {
    const v3 = { version: 3, measurement: { unit: "cm" }, help: { dismissedHints: [] } };
    const p = migratePreferences(v3);
    expect(p.measurement.unit).toBe("cm");
    expect(p.version).toBe(4);
    expect(p.inspector).toEqual(DEFAULT_PREFERENCES.inspector);
    expect(p.print).toEqual(DEFAULT_PREFERENCES.print);
  });
});
