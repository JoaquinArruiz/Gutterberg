import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, migratePreferences, normalizePreferences } from "./preferences";
import {
  applyPreset,
  canPlace,
  constrainLayout,
  defaultLayout,
  detectPreset,
  fitRegionSize,
  HEADER_PX,
  isRegionCollapsed,
  LAYOUT_PRESETS,
  LIBRARY_THUMB_ASPECT,
  LIBRARY_THUMB_CAPTION_PX,
  LIBRARY_THUMB_WIDTH,
  layoutOfPanel,
  MIN_EDITOR_W,
  normalizeLayout,
  PAGE_THUMB_HEIGHT,
  PANEL_DEFS,
  panelOrientation,
  regionMinSize,
  regionSize,
  regionsOf,
  SCROLLBAR_PX,
  STRIP_PX,
  setPanelCollapsed,
  setPanelPosition,
  type WorkspaceLayoutPrefs,
} from "./workspace-layout";

const ids = (l: WorkspaceLayoutPrefs, pos: "left" | "right" | "top" | "bottom") =>
  regionsOf(l.panels)[pos].map((p) => p.id);
const move = (l: WorkspaceLayoutPrefs, id: "pages" | "properties", pos: Parameters<typeof setPanelPosition>[2]) =>
  setPanelPosition(l, id, pos);

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
    const l = normalizeLayout({
      panels: [
        { id: "properties", position: "top" },
        { id: "nope", position: "left" },
      ],
      regionSizes: { left: "x" },
    });
    expect(l.panels.map((p) => p.id)).toEqual(["pages", "properties"]);
    expect(l.panels.find((p) => p.id === "properties")?.position).toBe("right");
    expect(l.regionSizes).toEqual({});
  });
});

describe("sizes", () => {
  it("are kept per position, so Left -> Top -> Left restores the old width", () => {
    let l: WorkspaceLayoutPrefs = { ...defaultLayout(), regionSizes: { left: 260 } };
    l = move(l, "pages", "top");
    expect(regionSize(l, "top", regionsOf(l.panels).top)).toBe(PANEL_DEFS.pages.defaultSize.horizontal); // its own default, not 260
    l = move(l, "pages", "left");
    expect(regionSize(l, "left", regionsOf(l.panels).left)).toBe(260);
  });
});

describe("the Print tab's layout", () => {
  const print = () => defaultLayout("print");

  it("is the piece library on the left and the settings on the right", () => {
    expect(ids(print(), "left")).toEqual(["library"]);
    expect(ids(print(), "right")).toEqual(["inspector"]);
    expect(detectPreset(print())).toBe("classic");
  });

  it("has its own panels, whatever a stored layout lists", () => {
    const l = normalizeLayout(
      {
        panels: [
          { id: "pages", position: "top" },
          { id: "library", position: "bottom" },
        ],
      },
      "print",
    );
    expect(l.panels.map((p) => `${p.id}:${p.position}`)).toEqual(["library:bottom", "inspector:right"]);
    // ... and the Source tab does not take the Print panels.
    expect(normalizeLayout({ panels: [{ id: "library", position: "top" }] }).panels.map((p) => p.id)).toEqual([
      "pages",
      "properties",
    ]);
  });

  it("lets the library go anywhere, but the settings (a vertical form) only left, right or hidden", () => {
    for (const pos of ["left", "right", "top", "bottom", "hidden"] as const)
      expect(canPlace("library", pos)).toBe(true);
    expect(canPlace("inspector", "top")).toBe(false);
    expect(canPlace("inspector", "bottom")).toBe(false);
    const l = print();
    expect(setPanelPosition(l, "inspector", "top")).toBe(l);
    expect(ids(setPanelPosition(l, "library", "bottom"), "bottom")).toEqual(["library"]);
  });

  it("has presets of its own, and each is recognised again", () => {
    for (const preset of LAYOUT_PRESETS.print) expect(detectPreset(applyPreset(print(), preset))).toBe(preset);
    expect(ids(applyPreset(print(), "library-top"), "top")).toEqual(["library"]);
    expect(ids(applyPreset(print(), "right-sidebar"), "right")).toEqual(["library", "inspector"]);
    expect(LAYOUT_PRESETS.print).not.toContain("pages-top");
    expect(LAYOUT_PRESETS.cards).not.toContain("library-top");
    // Moving one panel off every preset makes it custom.
    expect(detectPreset(setPanelPosition(print(), "library", "bottom"))).toBe("custom");
  });

  it("does not let a move in one tab change the other", () => {
    const source = defaultLayout();
    const moved = setPanelPosition(print(), "library", "right");
    expect(ids(moved, "right")).toEqual(["inspector", "library"]);
    expect(detectPreset(source)).toBe("classic");
    expect(layoutOfPanel("library")).toBe("print");
    expect(layoutOfPanel("pages")).toBe("cards");
  });
});

describe("the height of a strip at the top or bottom", () => {
  const strip = (l: WorkspaceLayoutPrefs, pos: "top" | "bottom") => regionSize(l, pos, regionsOf(l.panels)[pos]);

  it("is made from the thumbnails inside it: header, a thumbnail row, the room around it and a scrollbar", () => {
    const l = move(defaultLayout(), "pages", "top");
    expect(strip(l, "top")).toBe(HEADER_PX + PAGE_THUMB_HEIGHT + 40 + SCROLLBAR_PX);
    // Not the 124 px a row of thumbnails used to be cut off by.
    expect(strip(l, "top")).toBeGreaterThan(160);
  });

  it("is the same at the bottom, and for the Print tab's library with its taller thumbnails", () => {
    expect(strip(move(defaultLayout(), "pages", "bottom"), "bottom")).toBe(
      strip(move(defaultLayout(), "pages", "top"), "top"),
    );
    const library = setPanelPosition(defaultLayout("print"), "library", "top");
    const row = Math.ceil(LIBRARY_THUMB_WIDTH * LIBRARY_THUMB_ASPECT + LIBRARY_THUMB_CAPTION_PX);
    expect(PANEL_DEFS.library.minSize.horizontal).toBeGreaterThanOrEqual(HEADER_PX + row + SCROLLBAR_PX);
    expect(strip(library, "top")).toBeGreaterThanOrEqual(PANEL_DEFS.library.minSize.horizontal);
  });

  it("never goes below what the panel needs, even if a smaller size was remembered", () => {
    const old = { ...move(defaultLayout(), "pages", "top"), regionSizes: { top: 124 } };
    expect(strip(old, "top")).toBe(PANEL_DEFS.pages.minSize.horizontal);
    const bigger = { ...old, regionSizes: { top: 260 } };
    expect(strip(bigger, "top")).toBe(260);
  });

  it("is also a minimum when the strip is being dragged, so it cannot be dragged shorter", () => {
    const l = move(defaultLayout(), "pages", "top");
    expect(regionMinSize("top", regionsOf(l.panels).top)).toBe(PANEL_DEFS.pages.minSize.horizontal);
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

  it("keeps the Print panels at the smallest window, squeezing them before collapsing them", () => {
    // 900 px: the library (320) and the settings (300) would leave the sheets 280 px, but their minimums fit.
    const pref = defaultLayout("print");
    expect(constrainLayout(pref, { width: 900, height: 560 })).toBe(pref);
    const left = fitRegionSize(pref, "left", { width: 900, height: 560 });
    const right = fitRegionSize(pref, "right", { width: 900, height: 560 });
    expect(left).toBeGreaterThanOrEqual(PANEL_DEFS.library.minSize.vertical);
    expect(right).toBeGreaterThanOrEqual(PANEL_DEFS.inspector.minSize.vertical);
    expect(left + right + MIN_EDITOR_W).toBeLessThanOrEqual(900);
    // Where they have room they keep the remembered size.
    expect(fitRegionSize(pref, "left", { width: 1600, height: 900 })).toBe(320);
  });

  it("collapses the Print panels only when even their minimums leave the sheets too little", () => {
    const small = constrainLayout(defaultLayout("print"), { width: 600, height: 560 });
    expect(small.panels.every((p) => p.collapsed)).toBe(true);
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
    expect(p.help.dismissedHints).toEqual({});
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
