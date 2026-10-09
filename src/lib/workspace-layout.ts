// Workspace layout: WHERE the secondary panels sit around the editor.
// (Not to be confused with the Source/Output/Split view modes, which are what
// the editor itself shows.)
//
// The model is generic: a list of panel configs, each with a position and an
// order inside that position. Nothing here assumes "pages = left" or exactly two
// panels, so new panels (history, layers, ...) only need an entry in PANEL_DEFS,
// and a future drag-and-drop docker only needs to edit position/order/sizes.
//
// Each tab has its own layout (its own panels, positions and sizes): moving a panel in one
// never moves anything in the other. The Source tab ("cards") has Pages and Properties around the
// page view; the Print tab ("print") has the piece library and the settings around the sheets.

export type PanelId = "pages" | "properties" | "library" | "inspector";
export type PanelPosition = "left" | "right" | "top" | "bottom" | "hidden";
export type RegionPosition = Exclude<PanelPosition, "hidden">;
export type PanelOrientation = "vertical" | "horizontal";
/** The tab a layout belongs to. */
export type LayoutId = "cards" | "print";

export const LAYOUT_IDS: LayoutId[] = ["cards", "print"];
/** The panels of each tab, in the order presets give them slots (first, second). */
export const LAYOUT_PANELS: Record<LayoutId, PanelId[]> = {
  cards: ["pages", "properties"],
  print: ["library", "inspector"],
};
export const PANEL_IDS: PanelId[] = LAYOUT_IDS.flatMap((id) => LAYOUT_PANELS[id]);
/** The tab a panel belongs to. */
export const layoutOfPanel = (id: PanelId): LayoutId => (LAYOUT_PANELS.print.includes(id) ? "print" : "cards");
export const REGION_POSITIONS: RegionPosition[] = ["left", "right", "top", "bottom"];

export interface PanelConfig {
  id: PanelId;
  position: PanelPosition;
  /** Order among the panels sharing a position (lower = first). */
  order: number;
  /** This panel's share (percent) of its region when stacked with others, remembered per position. */
  stackSize?: Partial<Record<RegionPosition, number>>;
  collapsed?: boolean;
}

export interface WorkspaceLayoutPrefs {
  panels: PanelConfig[];
  /** Region thickness in px (width for left/right, height for top/bottom), remembered per position. */
  regionSizes: Partial<Record<RegionPosition, number>>;
  rememberSizes: boolean;
  rememberCollapsed: boolean;
}

/** Size of a panel header, and of a region whose panels are all collapsed. */
export const HEADER_PX = 28;
export const STRIP_PX = 32;
export const MIN_EDITOR_W = 360;
export const MIN_EDITOR_H = 260;

// A panel at the top or bottom is a strip, and its height comes from what is in it: a row of thumbnails with
// the room around them, a scrollbar for when the row is wider than the window, and the panel header.
/** Height of a page thumbnail in a strip. */
export const PAGE_THUMB_HEIGHT = 84;
/** Around a page thumbnail: its button padding (12), the gap to its number (4), the number (16), the list's bottom padding (8). */
const PAGE_THUMB_CHROME_PX = 40;
/** A horizontal scrollbar (the widest one any platform draws), reserved so it never covers the row. */
export const SCROLLBAR_PX = 17;
/** The piece library's thumbnails: a width, the picture's height as a multiple of it, the caption below, and the rows' gap. */
export const LIBRARY_THUMB_WIDTH = 84;
export const LIBRARY_THUMB_ASPECT = 1.35;
export const LIBRARY_THUMB_CAPTION_PX = 20;
export const LIBRARY_GRID_GAP = 6;
const LIBRARY_ROW_PX = Math.ceil(LIBRARY_THUMB_WIDTH * LIBRARY_THUMB_ASPECT + LIBRARY_THUMB_CAPTION_PX);
const PAGES_STRIP_PX = HEADER_PX + PAGE_THUMB_HEIGHT + PAGE_THUMB_CHROME_PX + SCROLLBAR_PX;
const LIBRARY_STRIP_PX = HEADER_PX + LIBRARY_ROW_PX + 2 * LIBRARY_GRID_GAP + SCROLLBAR_PX;

/** Static facts about each panel. Add an entry here to introduce a panel. */
export const PANEL_DEFS: Record<
  PanelId,
  {
    /** Positions this panel supports. Properties is a vertical form, so no top/bottom. */
    positions: PanelPosition[];
    defaultPosition: PanelPosition;
    defaultOrder: number;
    /** px thickness by orientation of the region it sits in. */
    defaultSize: Record<PanelOrientation, number>;
    minSize: Record<PanelOrientation, number>;
  }
> = {
  pages: {
    positions: ["left", "right", "top", "bottom", "hidden"],
    defaultPosition: "left",
    defaultOrder: 0,
    defaultSize: { vertical: 200, horizontal: PAGES_STRIP_PX },
    minSize: { vertical: 150, horizontal: PAGES_STRIP_PX },
  },
  properties: {
    positions: ["left", "right", "hidden"],
    defaultPosition: "right",
    defaultOrder: 0,
    defaultSize: { vertical: 280, horizontal: 280 },
    minSize: { vertical: 240, horizontal: 240 },
  },
  // The piece library has its controls and a grid of thumbnails, so it can sit anywhere.
  library: {
    positions: ["left", "right", "top", "bottom", "hidden"],
    defaultPosition: "left",
    defaultOrder: 0,
    defaultSize: { vertical: 320, horizontal: LIBRARY_STRIP_PX + 40 },
    minSize: { vertical: 200, horizontal: LIBRARY_STRIP_PX },
  },
  // The print settings are a vertical form, like Properties.
  inspector: {
    positions: ["left", "right", "hidden"],
    defaultPosition: "right",
    defaultOrder: 0,
    defaultSize: { vertical: 300, horizontal: 300 },
    minSize: { vertical: 220, horizontal: 220 },
  },
};

/** Left/right regions stack their panels vertically and show vertical thumbnails; top/bottom are horizontal. */
export const panelOrientation = (position: RegionPosition): PanelOrientation =>
  position === "left" || position === "right" ? "vertical" : "horizontal";

export const defaultLayout = (layout: LayoutId = "cards"): WorkspaceLayoutPrefs => ({
  panels: LAYOUT_PANELS[layout].map((id) => ({
    id,
    position: PANEL_DEFS[id].defaultPosition,
    order: PANEL_DEFS[id].defaultOrder,
  })),
  regionSizes: {},
  rememberSizes: true,
  rememberCollapsed: true,
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : undefined;

/** Raw -> valid layout: every panel of that tab exactly once, positions it supports, sane sizes. */
export function normalizeLayout(raw: unknown, layout: LayoutId = "cards"): WorkspaceLayoutPrefs {
  const d = defaultLayout(layout);
  const r = isObj(raw) ? raw : {};
  const rawPanels = Array.isArray(r.panels) ? r.panels.filter(isObj) : [];

  const panels = LAYOUT_PANELS[layout].map((id): PanelConfig => {
    const def = PANEL_DEFS[id];
    const p = rawPanels.find((x) => x.id === id) ?? {};
    const position = def.positions.includes(p.position as PanelPosition)
      ? (p.position as PanelPosition)
      : def.defaultPosition;
    const stackSize: PanelConfig["stackSize"] = {};
    if (isObj(p.stackSize)) {
      for (const pos of REGION_POSITIONS) {
        const v = num(p.stackSize[pos], 10, 90);
        if (v !== undefined) stackSize[pos] = v;
      }
    }
    return {
      id,
      position,
      order: num(p.order, 0, 99) ?? def.defaultOrder,
      ...(Object.keys(stackSize).length ? { stackSize } : {}),
      ...(p.collapsed === true ? { collapsed: true } : {}),
    };
  });

  const regionSizes: WorkspaceLayoutPrefs["regionSizes"] = {};
  if (isObj(r.regionSizes)) {
    for (const pos of REGION_POSITIONS) {
      const v = num(r.regionSizes[pos], 60, 2000);
      if (v !== undefined) regionSizes[pos] = Math.round(v);
    }
  }

  return {
    panels,
    regionSizes,
    rememberSizes: typeof r.rememberSizes === "boolean" ? r.rememberSizes : d.rememberSizes,
    rememberCollapsed: typeof r.rememberCollapsed === "boolean" ? r.rememberCollapsed : d.rememberCollapsed,
  };
}

const byOrder = (a: PanelConfig, b: PanelConfig) =>
  a.order - b.order || PANEL_IDS.indexOf(a.id) - PANEL_IDS.indexOf(b.id);

/** Panels of each region, in display order. Hidden panels appear nowhere. */
export function regionsOf(panels: PanelConfig[]): Record<RegionPosition, PanelConfig[]> {
  const out: Record<RegionPosition, PanelConfig[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of [...panels].sort(byOrder)) if (p.position !== "hidden") out[p.position].push(p);
  return out;
}

export const canPlace = (id: PanelId, position: PanelPosition) => PANEL_DEFS[id].positions.includes(position);

/** Move a panel. Unsupported positions are ignored. It joins the end of the destination's stack. */
export function setPanelPosition(
  layout: WorkspaceLayoutPrefs,
  id: PanelId,
  position: PanelPosition,
): WorkspaceLayoutPrefs {
  const cur = layout.panels.find((p) => p.id === id);
  if (!cur || cur.position === position || !canPlace(id, position)) return layout;
  const last = Math.max(-1, ...layout.panels.filter((p) => p.id !== id && p.position === position).map((p) => p.order));
  return {
    ...layout,
    panels: layout.panels.map((p) => (p.id === id ? { ...p, position, order: last + 1 } : p)),
  };
}

export const setPanelCollapsed = (
  layout: WorkspaceLayoutPrefs,
  id: PanelId,
  collapsed: boolean,
): WorkspaceLayoutPrefs => ({
  ...layout,
  panels: layout.panels.map((p) => {
    if (p.id !== id) return p;
    const { collapsed: _drop, ...rest } = p;
    return collapsed ? { ...rest, collapsed: true } : rest;
  }),
});

/**
 * Region thickness to start from: remembered, else the largest default among its panels. Never less than the
 * panels need, so a size remembered from before (or dragged to the edge) cannot crop what is inside.
 */
export function regionSize(layout: WorkspaceLayoutPrefs, position: RegionPosition, panels: PanelConfig[]) {
  const o = panelOrientation(position);
  const wanted = layout.regionSizes[position] ?? Math.max(...panels.map((p) => PANEL_DEFS[p.id].defaultSize[o]));
  return Math.max(wanted, regionMinSize(position, panels));
}

export const regionMinSize = (position: RegionPosition, panels: PanelConfig[]) =>
  Math.max(...panels.map((p) => PANEL_DEFS[p.id].minSize[panelOrientation(position)]));

export const isRegionCollapsed = (panels: PanelConfig[]) => panels.length > 0 && panels.every((p) => p.collapsed);

/** Thickness of a region when it is as small as its panels allow (a collapsed region is a strip). */
const minThickness = (regions: Record<RegionPosition, PanelConfig[]>, pos: RegionPosition) =>
  regions[pos].length === 0 ? 0 : isRegionCollapsed(regions[pos]) ? STRIP_PX : regionMinSize(pos, regions[pos]);

/**
 * The layout actually rendered for a window of this size. When even the smallest panels would squeeze
 * the editor too small, side/top/bottom panels are collapsed TEMPORARILY (the stored preference is never
 * touched), and the preferred layout comes back as soon as there is room. (Panels bigger than the room
 * left are made smaller first: see `fitRegionSize`.)
 */
export function constrainLayout(
  layout: WorkspaceLayoutPrefs,
  win: { width: number; height: number },
): WorkspaceLayoutPrefs {
  const regions = regionsOf(layout.panels);
  const collapseAxis = new Set<RegionPosition>();
  if (minThickness(regions, "left") + minThickness(regions, "right") + MIN_EDITOR_W > win.width)
    collapseAxis.add("left").add("right");
  if (minThickness(regions, "top") + minThickness(regions, "bottom") + MIN_EDITOR_H > win.height)
    collapseAxis.add("top").add("bottom");
  if (collapseAxis.size === 0) return layout;
  return {
    ...layout,
    panels: layout.panels.map((p) =>
      p.position !== "hidden" && collapseAxis.has(p.position) ? { ...p, collapsed: true } : p,
    ),
  };
}

const OPPOSITE: Record<RegionPosition, RegionPosition> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/**
 * The thickness a region starts at in a window of this size: the remembered or default one, unless the
 * editor would be left with less than its minimum, in which case the region gives way (down to its own
 * minimum). The opposite region keeps its own size.
 */
export function fitRegionSize(
  layout: WorkspaceLayoutPrefs,
  position: RegionPosition,
  win: { width: number; height: number },
) {
  const regions = regionsOf(layout.panels);
  const panels = regions[position];
  if (isRegionCollapsed(panels)) return STRIP_PX;
  const sideways = position === "left" || position === "right";
  const opposite = OPPOSITE[position];
  const wanted = regionSize(layout, position, panels);
  const other =
    regions[opposite].length === 0
      ? 0
      : isRegionCollapsed(regions[opposite])
        ? STRIP_PX
        : regionSize(layout, opposite, regions[opposite]);
  const room = (sideways ? win.width - MIN_EDITOR_W : win.height - MIN_EDITOR_H) - other;
  return Math.max(regionMinSize(position, panels), Math.min(wanted, room));
}

/**
 * Preset ids. Each tab offers the ones that fit its panels: `pages-top` is the Source tab's, `library-top`
 * the Print tab's (the first panel on top, the second on the right).
 */
export type LayoutPresetId = "classic" | "right-sidebar" | "pages-top" | "library-top" | "focus" | "custom";
type NamedPreset = Exclude<LayoutPresetId, "custom">;
export const LAYOUT_PRESETS: Record<LayoutId, NamedPreset[]> = {
  cards: ["classic", "right-sidebar", "pages-top", "focus"],
  print: ["classic", "right-sidebar", "library-top", "focus"],
};

/** Position and slot of a tab's first and second panel, for each preset. */
const PRESET_PANELS: Record<NamedPreset, [PanelPosition, number][]> = {
  classic: [
    ["left", 0],
    ["right", 0],
  ],
  "right-sidebar": [
    ["right", 0],
    ["right", 1],
  ],
  "pages-top": [
    ["top", 0],
    ["right", 0],
  ],
  "library-top": [
    ["top", 0],
    ["right", 0],
  ],
  focus: [
    ["hidden", 0],
    ["hidden", 1],
  ],
};

/** Whether a panel is the first or the second of its tab, which decides its place in a preset. */
const slotOf = (id: PanelId) => LAYOUT_PANELS[layoutOfPanel(id)].indexOf(id);

/** Apply a preset's positions/order, keeping remembered sizes and the "remember" switches. */
export function applyPreset(layout: WorkspaceLayoutPrefs, preset: NamedPreset): WorkspaceLayoutPrefs {
  return {
    ...layout,
    panels: layout.panels.map((p) => {
      const [position, order] = PRESET_PANELS[preset][slotOf(p.id)];
      return { ...p, position, order };
    }),
  };
}

/** Which preset the panel positions correspond to, or "custom". Sizes are ignored. */
export function detectPreset(layout: WorkspaceLayoutPrefs): LayoutPresetId {
  const regions = regionsOf(layout.panels);
  const tab = layout.panels[0] ? layoutOfPanel(layout.panels[0].id) : "cards";
  for (const preset of LAYOUT_PRESETS[tab]) {
    const matches = layout.panels.every((p) => {
      const [position, order] = PRESET_PANELS[preset][slotOf(p.id)];
      // Compare the slot within the region, not the raw `order` number; hidden panels have no slot.
      return (
        p.position === position &&
        (position === "hidden" || regions[position].findIndex((x) => x.id === p.id) === order)
      );
    });
    if (matches) return preset;
  }
  return "custom";
}
