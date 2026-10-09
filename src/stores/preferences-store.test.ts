import { describe, expect, it } from "vitest";
import { sessionDefaults } from "../lib/preferences";
import { switchWorkspace } from "../lib/workspace";
import { useEditorStore } from "./editor-store";
import {
  createPreferencesStore,
  type KeyValueStorage,
  PREFERENCES_KEY,
  usePreferencesStore,
} from "./preferences-store";

const memory = (initial?: string): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial ? [[PREFERENCES_KEY, initial]] : []);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe("first launch", () => {
  it("opens in the Source view, with every view available", () => {
    const fresh = createPreferencesStore(memory()).getState().prefs; // nothing stored yet
    expect(fresh.workspace.defaultMode).toBe("source");
    expect(sessionDefaults(fresh).viewMode).toBe("source");
    expect(fresh.workspace.visibleModes).toEqual(["source", "output", "split"]);
  });
});

describe("preferences store", () => {
  it("persists across a restart (a new store on the same storage)", () => {
    const storage = memory();
    const s = createPreferencesStore(storage).getState();
    s.setUnit("in");
    s.setDefaultMode("split");
    s.setLivePreview("always");

    const restarted = createPreferencesStore(storage).getState().prefs;
    expect(restarted.measurement.unit).toBe("in");
    expect(restarted.workspace.defaultMode).toBe("split");
    expect(restarted.preview.livePreview).toBe("always");
  });

  it("survives corrupt stored data", () => {
    expect(createPreferencesStore(memory("{not json")).getState().prefs.measurement.unit).toBe("mm");
  });

  it("disabling the default view picks a new valid default", () => {
    const st = createPreferencesStore(memory());
    st.getState().setDefaultMode("split");
    st.getState().setVisibleMode("split", false);
    expect(st.getState().prefs.workspace.defaultMode).toBe("source");
  });

  it("never lets the last view be disabled", () => {
    const st = createPreferencesStore(memory());
    st.getState().setVisibleMode("source", false);
    st.getState().setVisibleMode("output", false);
    st.getState().setVisibleMode("split", false);
    expect(st.getState().prefs.workspace.visibleModes).toEqual(["split"]);
  });

  it("toolbar modes follow the ordered preference", () => {
    const st = createPreferencesStore(memory());
    st.getState().setVisibleMode("output", false);
    expect(st.getState().prefs.workspace.visibleModes).toEqual(["source", "split"]);
    st.getState().moveVisibleMode("split", -1);
    expect(st.getState().prefs.workspace.visibleModes).toEqual(["split", "source"]);
  });

  it("reset restores the defaults", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setUnit("cm");
    st.getState().setTheme("dark");
    st.getState().setVisibleMode("output", false);
    st.getState().resetToDefaults();
    expect(st.getState().prefs.measurement.unit).toBe("mm");
    expect(st.getState().prefs.appearance.theme).toBe("system");
    expect(st.getState().prefs.workspace.visibleModes).toEqual(["source", "output", "split"]);
    expect(createPreferencesStore(storage).getState().prefs.measurement.unit).toBe("mm");
  });
});

describe("current workspace vs default", () => {
  it("opening the editor starts in the default; switching does not change the default", () => {
    const prefs = usePreferencesStore.getState();
    prefs.setDefaultMode("split");
    expect(sessionDefaults(usePreferencesStore.getState().prefs).viewMode).toBe("split");

    useEditorStore.getState().setViewMode("split");
    switchWorkspace("source"); // Split -> Source
    expect(useEditorStore.getState().viewMode).toBe("source");
    expect(usePreferencesStore.getState().prefs.workspace.defaultMode).toBe("split");
    expect(usePreferencesStore.getState().prefs.workspace.lastMode).toBe("source"); // remembered separately
    prefs.resetToDefaults();
  });
});

describe("workspace layout in the store", () => {
  const regions = (st: ReturnType<typeof createPreferencesStore>) => {
    const l = st.getState().prefs.workspace.layout;
    return l.panels.map((p) => `${p.id}:${p.position}`).sort();
  };

  it("persists panel positions across a restart", () => {
    const storage = memory();
    const st = createPreferencesStore(storage).getState();
    st.setPanelPosition("pages", "top");
    st.setPanelPosition("properties", "left");
    expect(regions(createPreferencesStore(storage))).toEqual(["pages:top", "properties:left"]);
  });

  it("persists dragged sizes when 'remember sizes' is on, and ignores them when it is off", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().saveRegionSize("cards", "left", 333);
    st.getState().saveStackSize("pages", "left", 40);
    const back = createPreferencesStore(storage).getState().prefs.workspace.layout;
    expect(back.regionSizes.left).toBe(333);
    expect(back.panels.find((p) => p.id === "pages")?.stackSize?.left).toBe(40);

    st.getState().setRememberSizes(false);
    const off = createPreferencesStore(storage).getState().prefs.workspace.layout;
    expect(off.regionSizes).toEqual({});
    expect(off.panels.find((p) => p.id === "pages")?.stackSize).toBeUndefined();
  });

  it("collapsed state is restored only when 'remember collapsed' is on", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setPanelCollapsed("pages", true);
    expect(
      createPreferencesStore(storage)
        .getState()
        .prefs.workspace.layout.panels.find((p) => p.id === "pages")?.collapsed,
    ).toBe(true);
    st.getState().setRememberCollapsed(false);
    expect(
      createPreferencesStore(storage)
        .getState()
        .prefs.workspace.layout.panels.find((p) => p.id === "pages")?.collapsed,
    ).toBeUndefined();
  });

  it("applying a preset updates positions", () => {
    const st = createPreferencesStore(memory());
    st.getState().applyLayoutPreset("cards", "right-sidebar");
    expect(regions(st)).toEqual(["pages:right", "properties:right"]);
  });

  it("Reset workspace restores the layout and views but keeps unit, theme and live preview", () => {
    const st = createPreferencesStore(memory());
    const s = st.getState();
    s.setUnit("in");
    s.setTheme("dark");
    s.setLivePreview("always");
    s.setPanelPosition("pages", "bottom");
    s.saveRegionSize("cards", "bottom", 200);
    s.setVisibleMode("output", false);
    s.setDefaultMode("split");
    st.getState().resetWorkspace();
    const p = st.getState().prefs;
    expect(regions(st)).toEqual(["pages:left", "properties:right"]);
    expect(p.workspace.layout.regionSizes).toEqual({});
    expect(p.workspace.visibleModes).toEqual(["source", "output", "split"]);
    expect(p.workspace.defaultMode).toBe("source");
    expect(p.measurement.unit).toBe("in");
    expect(p.appearance.theme).toBe("dark");
    expect(p.preview.livePreview).toBe("always");
  });
});

describe("help tips", () => {
  it("a dismissed tip stays dismissed across a restart", () => {
    const storage = memory();
    createPreferencesStore(storage).getState().dismissHint("live-preview-output");
    expect(createPreferencesStore(storage).getState().prefs.help.dismissedHints).toEqual({ "live-preview-output": 1 });
  });

  it("dismissing twice does not duplicate", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-output");
    st.getState().dismissHint("live-preview-output");
    expect(st.getState().prefs.help.dismissedHints).toEqual({ "live-preview-output": 1 });
  });

  it("Reset help tips shows them again, and leaves other preferences alone", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setUnit("in");
    st.getState().dismissHint("live-preview-output");
    st.getState().resetHints();
    expect(createPreferencesStore(storage).getState().prefs.help.dismissedHints).toEqual({});
    expect(createPreferencesStore(storage).getState().prefs.measurement.unit).toBe("in");
  });

  it("Reset all preferences also brings the tips back", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-output");
    st.getState().resetToDefaults();
    expect(st.getState().prefs.help.dismissedHints).toEqual({});
  });

  it("Reset workspace does not touch the tips", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-output");
    st.getState().resetWorkspace();
    expect(st.getState().prefs.help.dismissedHints).toEqual({ "live-preview-output": 1 });
  });
});

describe("inspector sections", () => {
  it("remember which sections are open across a restart", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setSectionOpen("print.page", true);
    st.getState().setSectionOpen("print.plan", false);
    const back = createPreferencesStore(storage).getState().prefs.inspector.sections;
    expect(back).toEqual({ "print.page": true, "print.plan": false });
  });

  it("survive Reset workspace but not Reset all preferences", () => {
    const st = createPreferencesStore(memory());
    st.getState().setSectionOpen("print.page", true);
    st.getState().resetWorkspace();
    expect(st.getState().prefs.inspector.sections).toEqual({ "print.page": true });
    st.getState().resetToDefaults();
    expect(st.getState().prefs.inspector.sections).toEqual({});
  });
});

describe("Print tab layout", () => {
  const printPanels = (st: ReturnType<typeof createPreferencesStore>) =>
    st
      .getState()
      .prefs.print.layout.panels.map((p) => `${p.id}:${p.position}`)
      .sort();
  const sourcePanels = (st: ReturnType<typeof createPreferencesStore>) =>
    st
      .getState()
      .prefs.workspace.layout.panels.map((p) => `${p.id}:${p.position}`)
      .sort();

  it("starts with the piece library on the left and the settings on the right", () => {
    expect(printPanels(createPreferencesStore(memory()))).toEqual(["inspector:right", "library:left"]);
  });

  it("moves a panel in one tab without touching the other, and keeps it across a restart", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setPanelPosition("library", "bottom");
    st.getState().setPanelPosition("inspector", "left");
    expect(printPanels(createPreferencesStore(storage))).toEqual(["inspector:left", "library:bottom"]);
    expect(sourcePanels(st)).toEqual(["pages:left", "properties:right"]);

    st.getState().setPanelPosition("pages", "top");
    expect(printPanels(st)).toEqual(["inspector:left", "library:bottom"]);
    expect(sourcePanels(st)).toEqual(["pages:top", "properties:right"]);
  });

  it("keeps the dragged sizes of each tab apart, and ignores them when 'remember sizes' is off", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().saveRegionSize("print", "left", 410);
    st.getState().saveRegionSize("cards", "left", 222);
    const back = createPreferencesStore(storage).getState().prefs;
    expect(back.print.layout.regionSizes.left).toBe(410);
    expect(back.workspace.layout.regionSizes.left).toBe(222);

    st.getState().setRememberSizes(false);
    expect(st.getState().prefs.print.layout.rememberSizes).toBe(false); // one setting for both tabs
    expect(createPreferencesStore(storage).getState().prefs.print.layout.regionSizes).toEqual({});
    st.getState().saveRegionSize("print", "left", 500);
    expect(st.getState().prefs.print.layout.regionSizes.left).toBe(410); // not saved while off
  });

  it("applies a preset to one tab only", () => {
    const st = createPreferencesStore(memory());
    st.getState().applyLayoutPreset("print", "library-top");
    expect(printPanels(st)).toEqual(["inspector:right", "library:top"]);
    expect(sourcePanels(st)).toEqual(["pages:left", "properties:right"]);
  });

  it("Reset workspace restores both layouts", () => {
    const st = createPreferencesStore(memory());
    st.getState().setPanelPosition("library", "hidden");
    st.getState().saveRegionSize("print", "right", 450);
    st.getState().setPanelPosition("pages", "bottom");
    st.getState().resetWorkspace();
    expect(printPanels(st)).toEqual(["inspector:right", "library:left"]);
    expect(st.getState().prefs.print.layout.regionSizes).toEqual({});
    expect(sourcePanels(st)).toEqual(["pages:left", "properties:right"]);
  });

  it("moves a panel from the toolbar menu's id alone: the tab is known from the panel", () => {
    const st = createPreferencesStore(memory());
    st.getState().setPanelCollapsed("inspector", true);
    expect(st.getState().prefs.print.layout.panels.find((p) => p.id === "inspector")?.collapsed).toBe(true);
    expect(st.getState().prefs.workspace.layout.panels.some((p) => p.collapsed)).toBe(false);
  });
});

describe("recent projects", () => {
  it("lists the newest first, once each, and forgets one that is gone", () => {
    const store = createPreferencesStore(memory());
    const { addRecentProject, removeRecentProject } = store.getState();
    for (const p of ["/a.gtr", "/b.gtr", "/a.gtr"]) addRecentProject(p);
    expect(store.getState().prefs.files.recent).toEqual(["/a.gtr", "/b.gtr"]);
    removeRecentProject("/a.gtr");
    expect(store.getState().prefs.files.recent).toEqual(["/b.gtr"]);
  });

  it("survive a restart, and the reset to defaults", () => {
    const storage = memory();
    const first = createPreferencesStore(storage);
    first.getState().addRecentProject("/a.gtr");
    first.getState().savePreset({
      name: "poker",
      rows: 3,
      columns: 3,
      sourceGapXMm: 0,
      sourceGapYMm: 0,
      sourceGapLinked: true,
    });
    first.getState().resetToDefaults();
    const second = createPreferencesStore(storage).getState().prefs;
    expect(second.files.recent).toEqual(["/a.gtr"]);
    expect(second.presets.map((p) => p.name)).toEqual(["poker"]);
  });
});

describe("presets", () => {
  const preset = (name: string, rows: number) => ({
    name,
    rows,
    columns: 3,
    sourceGapXMm: 0,
    sourceGapYMm: 0,
    sourceGapLinked: true,
  });

  it("are saved by name, replacing one of the same name (ignoring case), and deleted", () => {
    const store = createPreferencesStore(memory());
    const s = store.getState();
    s.savePreset(preset("Poker", 3));
    s.savePreset(preset("Tarot", 2));
    s.savePreset(preset("poker", 4));
    expect(store.getState().prefs.presets.map((p) => [p.name, p.rows])).toEqual([
      ["poker", 4],
      ["Tarot", 2],
    ]);
    s.deletePreset("Tarot");
    expect(store.getState().prefs.presets.map((p) => p.name)).toEqual(["poker"]);
  });
});
