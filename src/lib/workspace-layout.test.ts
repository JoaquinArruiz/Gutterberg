import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, migratePreferences, normalizePreferences } from "./preferences";
import {
  applyPreset, canPlace, constrainLayout, defaultLayout, detectPreset, isRegionCollapsed, MIN_EDITOR_W, normalizeLayout,
  panelOrientation, regionsOf, regionSize, setPanelCollapsed, setPanelPosition, STRIP_PX, type WorkspaceLayoutPrefs,
} from "./workspace-layout";

const ids = (l: WorkspaceLayoutPrefs, pos: "left" | "right" | "top" | "bottom") => regionsOf(l.panels)[pos].map((p) => p.id);
const move = (l: WorkspaceLayoutPrefs, id: "pages" | "properties", pos: Parameters<typeof setPanelPosition>[2]) => setPanelPosition(l, id, pos);

describe("default layout", () => {
  it("is Pages left, Properties right", () => {
    const l = defaultLayout();
    expect(ids(l, "left")).toEqual(["pages"]);
    expect(ids(l, "right")).toEqual(["properties"]);
    expect(detectPreset(l)).toBe("classic");
  });
});

describe("placement", () => {
  it("both on the right stack in order", () => {
    const l = move(defaultLayout(), "pages", "right");
    expect(ids(l, "right")).toEqual(["properties", "pages"]); // pages joins the end of the stack
    expect(ids(l, "left")).toEqual([]);
  });

  it("order decides the stack", () => {
    const l = applyPreset(defaultLayout(), "right-sidebar");
    expect(ids(l, "right")).toEqual(["pages", "properties"]);
    const flipped = { ...l, panels: l.panels.map((p) => ({ ...p, order: p.id === "pages" ? 1 : 0 })) };
    expect(ids(flipped, "right")).toEqual(["properties", "pages"]);
  });

  it("orientation follows the position: top/bottom horizontal, left/right vertical", () => {
    expect(panelOrientation("top")).toBe("horizontal");
    expect(panelOrientation("bottom")).toBe("horizontal");
    expect(panelOrientation("left")).toBe("vertical");
    expect(panelOrientation("right")).toBe("vertical");
  });

  it("Properties cannot go top or bottom; Pages can go anywhere", () => {
    expect(canPlace("properties", "top")).toBe(false);
    const l = defaultLayout();
    expect(move(l, "properties", "top")).toBe(l);
    for (const pos of ["left", "right", "top", "bottom", "hidden"] as const) expect(canPlace("pages", pos)).toBe(true);
  });

  it("hiding a panel removes its region; showing it again returns it to the chosen position", () => {
    const hidden = move(defaultLayout(), "pages", "hidden");
    expect(ids(hidden, "left")).toEqual([]); // so the editor takes the freed width
    const back = move(hidden, "pages", "left");
    expect(ids(back, "left")).toEqual(["pages"]);
  });

  it("detects presets and falls back to custom", () => {
    expect(detectPreset(applyPreset(defaultLayout(), "pages-top"))).toBe("pages-top");
    expect(detectPreset(applyPreset(defaultLayout(), "focus"))).toBe("focus");
    expect(detectPreset(move(defaultLayout(), "pages", "bottom"))).toBe("custom");
  });
});

describe("normalizeLayout", () => {
  it("repairs garbage, unsupported positions and missing panels", () => {
    const l = normalizeLayout({ panels: [{ id: "properties", position: "top" }, { id: "nope", position: "left" }], regionSizes: { left: "x" } });
    expect(l.panels.map((p) => p.id)).toEqual(["pages", "properties"]);
    expect(l.panels.find((p) => p.id === "properties")?.position).toBe("right");
    expect(l.regionSizes).toEqual({});
  });
});

describe("sizes", () => {
  it("are kept per position, so Left -> Top -> Left restores the old width", () => {
    let l: WorkspaceLayoutPrefs = { ...defaultLayout(), regionSizes: { left: 260 } };
    l = move(l, "pages", "top");
    expect(regionSize(l, "top", regionsOf(l.panels).top)).toBe(124); // its own default, not 260
    l = move(l, "pages", "left");
    expect(regionSize(l, "left", regionsOf(l.panels).left)).toBe(260);
  });
});

describe("small windows", () => {
  it("collapses side panels temporarily without changing the preference", () => {
    const pref = defaultLayout();
    const small = constrainLayout(pref, { width: MIN_EDITOR_W + 100, height: 900 });
    expect(small.panels.every((p) => p.collapsed)).toBe(true);
    expect(isRegionCollapsed(regionsOf(small.panels).left)).toBe(true);
    expect(regionSize(small, "left", regionsOf(small.panels).left)).toBeGreaterThan(STRIP_PX); // pref size untouched
    expect(pref.panels.some((p) => p.collapsed)).toBe(false);
    expect(constrainLayout(pref, { width: 1600, height: 900 })).toBe(pref); // room again: preferred layout
  });
});

describe("collapse", () => {
  it("toggles per panel", () => {
    const l = setPanelCollapsed(defaultLayout(), "pages", true);
    expect(l.panels.find((p) => p.id === "pages")?.collapsed).toBe(true);
    expect(setPanelCollapsed(l, "pages", false).panels.find((p) => p.id === "pages")?.collapsed).toBeUndefined();
  });
});

describe("preferences migration", () => {
  it("v1 preferences gain the default layout and keep every other setting", () => {
    const v1 = {
      version: 1,
      measurement: { unit: "in" },
      workspace: { visibleModes: ["split", "source"], defaultMode: "split", lastMode: "split" },
      preview: { livePreview: "always" },
      appearance: { theme: "dark" },
    };
    const p = migratePreferences(v1);
    expect(p.version).toBe(DEFAULT_PREFERENCES.version);
    expect(p.help.dismissedHints).toEqual([]);
    expect(p.measurement.unit).toBe("in");
    expect(p.workspace.visibleModes).toEqual(["split", "source"]);
    expect(p.workspace.defaultMode).toBe("split");
    expect(p.preview.livePreview).toBe("always");
    expect(p.appearance.theme).toBe("dark");
    expect(p.workspace.layout).toEqual(defaultLayout());
  });

  it("normalizing keeps a saved layout", () => {
    const layout = move(move(defaultLayout(), "pages", "top"), "properties", "left");
    const p = normalizePreferences({ ...DEFAULT_PREFERENCES, workspace: { ...DEFAULT_PREFERENCES.workspace, layout } });
    expect(ids(p.workspace.layout, "top")).toEqual(["pages"]);
    expect(ids(p.workspace.layout, "left")).toEqual(["properties"]);
  });
});
