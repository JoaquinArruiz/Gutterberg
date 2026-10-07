import { describe, expect, it } from "vitest";
import {
  type AppPreferences,
  DEFAULT_PREFERENCES,
  MAX_RECENT_PROJECTS,
  migratePreferences,
  moveMode,
  normalizePreferences,
  PREFERENCES_VERSION,
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
  it("drops unknown tip ids and bad versions", () => {
    const p = normalizePreferences({
      help: {
        dismissedHints: { "print-stage-intro": 2, gone: 1, "live-preview-output": "x", "live-preview-sheets": 0 },
      },
    });
    expect(p.help.dismissedHints).toEqual({ "print-stage-intro": 2 });
  });

  it("turns an old list of dismissed tips into version 1 entries", () => {
    const p = migratePreferences({
      version: 4,
      help: { dismissedHints: ["print-stage-intro", "gone", "print-stage-intro", 3] },
    });
    expect(p.help.dismissedHints).toEqual({ "print-stage-intro": 1 });
  });

  it("closing the old shared live-preview tip closes both new ones", () => {
    const p = migratePreferences({ version: 4, help: { dismissedHints: ["live-preview-manual"] } });
    expect(p.help.dismissedHints).toEqual({ "live-preview-output": 1, "live-preview-sheets": 1 });
  });

  it("older preferences without `help` get an empty list and keep their settings", () => {
    const v2 = { version: 2, measurement: { unit: "cm" } };
    const p = migratePreferences(v2);
    expect(p.help.dismissedHints).toEqual({});
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
    expect(p.version).toBe(PREFERENCES_VERSION);
    expect(p.inspector).toEqual(DEFAULT_PREFERENCES.inspector);
    expect(p.print).toEqual(DEFAULT_PREFERENCES.print);
  });
});

describe("language and decimal separator", () => {
  it("default to following the system", () => {
    expect(DEFAULT_PREFERENCES.locale).toEqual({ language: "system", decimal: "auto" });
  });

  it("load from a version 5 file, which had neither, with the defaults and nothing else lost", () => {
    const v5 = { version: 5, measurement: { unit: "cm" }, appearance: { theme: "dark" }, help: { dismissedHints: {} } };
    const p = migratePreferences(v5);
    expect(p.locale).toEqual({ language: "system", decimal: "auto" });
    expect(p.measurement.unit).toBe("cm");
    expect(p.appearance.theme).toBe("dark");
    expect(p.version).toBe(PREFERENCES_VERSION);
  });

  it("keep valid choices and drop anything else", () => {
    expect(normalizePreferences({ locale: { language: "es", decimal: "comma" } }).locale).toEqual({
      language: "es",
      decimal: "comma",
    });
    expect(normalizePreferences({ locale: { language: "fr", decimal: ";" } }).locale).toEqual({
      language: "system",
      decimal: "auto",
    });
    expect(normalizePreferences({ locale: "es" }).locale).toEqual(DEFAULT_PREFERENCES.locale);
  });
});

describe("recent projects and presets", () => {
  it("start empty, also for a version 6 file that had neither", () => {
    expect(DEFAULT_PREFERENCES.files.recent).toEqual([]);
    expect(DEFAULT_PREFERENCES.presets).toEqual([]);
    const v6 = migratePreferences({ version: 6, measurement: { unit: "in" } });
    expect(v6.measurement.unit).toBe("in");
    expect(v6.files).toEqual({ recent: [] });
    expect(v6.presets).toEqual([]);
    expect(v6.version).toBe(PREFERENCES_VERSION);
  });

  it("keep a short list of distinct project paths", () => {
    const many = Array.from({ length: 20 }, (_, i) => `/p/${i}.gtr`);
    const p = normalizePreferences({ files: { recent: ["/a.gtr", "", 5, "/a.gtr", ...many] } });
    expect(p.files.recent).toHaveLength(MAX_RECENT_PROJECTS);
    expect(p.files.recent.slice(0, 3)).toEqual(["/a.gtr", "/p/0.gtr", "/p/1.gtr"]);
    expect(normalizePreferences({ files: "x" }).files).toEqual({ recent: [] });
  });

  it("keep presets with a name and a grid inside the allowed range", () => {
    const p = normalizePreferences({
      presets: [
        { name: "  3×3 poker  ", rows: 3, columns: 3, sourceGapXMm: 0, sourceGapYMm: 0, sourceGapLinked: true },
        { name: "3×3 POKER", rows: 9, columns: 9 },
        { name: "", rows: 2, columns: 2 },
        { rows: 2, columns: 2 },
        { name: "wild", rows: 500, columns: -3, sourceGapXMm: 900, sourceGapYMm: 4, sourceGapLinked: false },
        "nope",
      ],
    });
    expect(p.presets.map((x) => x.name)).toEqual(["3×3 poker", "wild"]);
    expect(p.presets[1]).toMatchObject({ rows: 30, columns: 1, sourceGapXMm: 50, sourceGapYMm: 4 });
  });

  it("make a linked vertical gap follow the horizontal one", () => {
    const p = normalizePreferences({
      presets: [{ name: "a", rows: 1, columns: 1, sourceGapXMm: 2, sourceGapYMm: 7, sourceGapLinked: true }],
    });
    expect(p.presets[0].sourceGapYMm).toBe(2);
  });
});
