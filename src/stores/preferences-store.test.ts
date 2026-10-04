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
