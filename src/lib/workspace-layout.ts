// Workspace layout: WHERE the secondary panels sit around the editor.
// (Not to be confused with the Source/Output/Split view modes, which are what
// the editor itself shows.)
//
// The model is generic: a list of panel configs, each with a position and an
// order inside that position. Nothing here assumes "pages = left" or exactly two
// panels, so new panels (history, layers, ...) only need an entry in PANEL_DEFS,
// and a future drag-and-drop docker only needs to edit position/order/sizes.

export type PanelId = "pages" | "properties";
export type PanelPosition = "left" | "right" | "top" | "bottom" | "hidden";
export type RegionPosition = Exclude<PanelPosition, "hidden">;
export type PanelOrientation = "vertical" | "horizontal";

export const PANEL_IDS: PanelId[] = ["pages", "properties"];
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
    defaultSize: { vertical: 200, horizontal: 124 },
    minSize: { vertical: 150, horizontal: 100 },
  },
  properties: {
    positions: ["left", "right", "hidden"],
    defaultPosition: "right",
    defaultOrder: 0,
    defaultSize: { vertical: 280, horizontal: 280 },
    minSize: { vertical: 240, horizontal: 240 },
  },
};

/** Size of a panel header, and of a region whose panels are all collapsed. */
export const HEADER_PX = 28;
export const STRIP_PX = 32;
export const MIN_EDITOR_W = 360;
export const MIN_EDITOR_H = 260;

/** Left/right regions stack their panels vertically and show vertical thumbnails; top/bottom are horizontal. */
export const panelOrientation = (position: RegionPosition): PanelOrientation =>
  position === "left" || position === "right" ? "vertical" : "horizontal";

export const defaultLayout = (): WorkspaceLayoutPrefs => ({
  panels: PANEL_IDS.map((id) => ({ id, position: PANEL_DEFS[id].defaultPosition, order: PANEL_DEFS[id].defaultOrder })),
  regionSizes: {},
  rememberSizes: true,
  rememberCollapsed: true,
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : undefined;

/** Raw -> valid layout: every known panel exactly once, positions it supports, sane sizes. */
export function normalizeLayout(raw: unknown): WorkspaceLayoutPrefs {
  const d = defaultLayout();
  const r = isObj(raw) ? raw : {};
  const rawPanels = Array.isArray(r.panels) ? r.panels.filter(isObj) : [];

  const panels = PANEL_IDS.map((id): PanelConfig => {
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

/** Region thickness to start from: remembered, else the largest default among its panels. */
export function regionSize(layout: WorkspaceLayoutPrefs, position: RegionPosition, panels: PanelConfig[]) {
  const o = panelOrientation(position);
  return layout.regionSizes[position] ?? Math.max(...panels.map((p) => PANEL_DEFS[p.id].defaultSize[o]));
}

export const regionMinSize = (position: RegionPosition, panels: PanelConfig[]) =>
  Math.max(...panels.map((p) => PANEL_DEFS[p.id].minSize[panelOrientation(position)]));

export const isRegionCollapsed = (panels: PanelConfig[]) => panels.length > 0 && panels.every((p) => p.collapsed);

/**
 * The layout actually rendered for a window of this size. When the preferred
 * layout would squeeze the editor too small, side/top/bottom panels are
 * collapsed TEMPORARILY (the stored preference is never touched), and the
 * preferred layout comes back as soon as there is room.
 */
export function constrainLayout(
  layout: WorkspaceLayoutPrefs,
  win: { width: number; height: number },
): WorkspaceLayoutPrefs {
  const regions = regionsOf(layout.panels);
  const thickness = (pos: RegionPosition) =>
    regions[pos].length === 0 ? 0 : isRegionCollapsed(regions[pos]) ? STRIP_PX : regionSize(layout, pos, regions[pos]);
  const collapseAxis = new Set<RegionPosition>();
  if (thickness("left") + thickness("right") + MIN_EDITOR_W > win.width) collapseAxis.add("left").add("right");
  if (thickness("top") + thickness("bottom") + MIN_EDITOR_H > win.height) collapseAxis.add("top").add("bottom");
  if (collapseAxis.size === 0) return layout;
  return {
    ...layout,
    panels: layout.panels.map((p) =>
      p.position !== "hidden" && collapseAxis.has(p.position) ? { ...p, collapsed: true } : p,
    ),
  };
}

export type LayoutPresetId = "classic" | "right-sidebar" | "pages-top" | "focus" | "custom";
export const LAYOUT_PRESETS: Exclude<LayoutPresetId, "custom">[] = ["classic", "right-sidebar", "pages-top", "focus"];

const PRESET_PANELS: Record<Exclude<LayoutPresetId, "custom">, [PanelPosition, number][]> = {
  //                      pages            properties
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
  focus: [
    ["hidden", 0],
    ["hidden", 1],
  ],
};

/** Apply a preset's positions/order, keeping remembered sizes and the "remember" switches. */
export function applyPreset(
  layout: WorkspaceLayoutPrefs,
  preset: Exclude<LayoutPresetId, "custom">,
): WorkspaceLayoutPrefs {
  return {
    ...layout,
    panels: layout.panels.map((p) => {
      const [position, order] = PRESET_PANELS[preset][PANEL_IDS.indexOf(p.id)];
      return { ...p, position, order };
    }),
  };
}

/** Which preset the panel positions correspond to, or "custom". Sizes are ignored. */
export function detectPreset(layout: WorkspaceLayoutPrefs): LayoutPresetId {
  const regions = regionsOf(layout.panels);
  for (const preset of LAYOUT_PRESETS) {
    const matches = layout.panels.every((p) => {
      const [position, order] = PRESET_PANELS[preset][PANEL_IDS.indexOf(p.id)];
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
