import { describe, expect, it } from "vitest";
import { sessionDefaults } from "../lib/preferences";
import { switchWorkspace } from "../lib/workspace";
import { useEditorStore } from "./editor-store";
import {
  createPreferencesStore, PREFERENCES_KEY, usePreferencesStore, type KeyValueStorage,
} from "./preferences-store";

const memory = (initial?: string): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial ? [[PREFERENCES_KEY, initial]] : []);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
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
    st.getState().saveRegionSize("left", 333);
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
    expect(createPreferencesStore(storage).getState().prefs.workspace.layout.panels.find((p) => p.id === "pages")?.collapsed).toBe(true);
    st.getState().setRememberCollapsed(false);
    expect(createPreferencesStore(storage).getState().prefs.workspace.layout.panels.find((p) => p.id === "pages")?.collapsed).toBeUndefined();
  });

  it("applying a preset updates positions", () => {
    const st = createPreferencesStore(memory());
    st.getState().applyLayoutPreset("right-sidebar");
    expect(regions(st)).toEqual(["pages:right", "properties:right"]);
  });

  it("Reset workspace restores the layout and views but keeps unit, theme and live preview", () => {
    const st = createPreferencesStore(memory());
    const s = st.getState();
    s.setUnit("in");
    s.setTheme("dark");
    s.setLivePreview("always");
    s.setPanelPosition("pages", "bottom");
    s.saveRegionSize("bottom", 200);
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
    createPreferencesStore(storage).getState().dismissHint("live-preview-manual");
    expect(createPreferencesStore(storage).getState().prefs.help.dismissedHints).toEqual(["live-preview-manual"]);
  });

  it("dismissing twice does not duplicate", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-manual");
    st.getState().dismissHint("live-preview-manual");
    expect(st.getState().prefs.help.dismissedHints).toEqual(["live-preview-manual"]);
  });

  it("Reset help tips shows them again, and leaves other preferences alone", () => {
    const storage = memory();
    const st = createPreferencesStore(storage);
    st.getState().setUnit("in");
    st.getState().dismissHint("live-preview-manual");
    st.getState().resetHints();
    expect(createPreferencesStore(storage).getState().prefs.help.dismissedHints).toEqual([]);
    expect(createPreferencesStore(storage).getState().prefs.measurement.unit).toBe("in");
  });

  it("Reset all preferences also brings the tips back", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-manual");
    st.getState().resetToDefaults();
    expect(st.getState().prefs.help.dismissedHints).toEqual([]);
  });

  it("Reset workspace does not touch the tips", () => {
    const st = createPreferencesStore(memory());
    st.getState().dismissHint("live-preview-manual");
    st.getState().resetWorkspace();
    expect(st.getState().prefs.help.dismissedHints).toEqual(["live-preview-manual"]);
  });
});
