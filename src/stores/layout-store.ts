import { create } from "zustand";
import type { NormalizedRect } from "../lib/coordinates";
import { clampCount } from "../lib/grid";
import type { LayoutResult } from "../lib/layout-api";
import type { GridPayload } from "../lib/tauri";
import { sessionDefaults } from "../lib/preferences";
import { mmToPt } from "../lib/units";
import { usePreferencesStore } from "./preferences-store";

export const MAX_GAP_MM = 50;
export const MAX_MARGIN_MM = 100;
const gap = (mm: number) => Math.min(Math.max(mm, 0), MAX_GAP_MM);
const margin = (mm: number) => Math.min(Math.max(mm, 0), MAX_MARGIN_MM);

export type PageMode = "same" | "a4" | "letter" | "legal" | "custom" | "fit";
export type Orientation = "portrait" | "landscape";

export const PAGE_PRESETS_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
} as const;

type Margins = { top: number; right: number; bottom: number; left: number };

/**
 * Layout/export settings. Currently one layout for the whole document; kept
 * separate from editor state so it can later be keyed by page range
 * (e.g. pages 1-10 = 3x3, pages 11-12 = 2x2).
 */
type LayoutState = {
  rows: number;
  columns: number;
  /** OUTPUT spacing between cards. */
  gapXMm: number;
  gapYMm: number;
  /** SOURCE spacing already present between cards in the PDF. */
  sourceGapXMm: number;
  sourceGapYMm: number;
  /** When linked, the vertical value follows the horizontal one. */
  gapLinked: boolean;
  sourceGapLinked: boolean;
  /** Output page. `same` = source page size; `fit` = sized around the cards. */
  pageMode: PageMode;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  margins: Margins;
  /** Live output preview for this session (initial value = Live Preview preference). */
  live: boolean;
  /** Result frozen by "Update preview" (manual mode). */
  snapshot: LayoutResult | null;
  /** Placements from the Rust layout engine for the current page; null if no selection or the grid is invalid. */
  result: LayoutResult | null;
  /** Why `result` is null despite a selection. */
  layoutError: string | null;
  setRows: (n: number) => void;
  setColumns: (n: number) => void;
  setGapX: (mm: number) => void;
  setGapY: (mm: number) => void;
  setSourceGapX: (mm: number) => void;
  setSourceGapY: (mm: number) => void;
  setGapLinked: (linked: boolean) => void;
  setSourceGapLinked: (linked: boolean) => void;
  setPageMode: (m: PageMode) => void;
  setOrientation: (o: Orientation) => void;
  setCustomSize: (width?: number, height?: number) => void;
  setMargin: (side: keyof Margins, mm: number) => void;
  setLive: (live: boolean) => void;
  updatePreview: () => void;
  clearSnapshot: () => void;
  setResult: (result: LayoutResult | null, error: string | null) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
  rows: 3,
  columns: 3,
  gapXMm: 3,
  gapYMm: 3,
  sourceGapXMm: 0,
  sourceGapYMm: 0,
  gapLinked: true,
  sourceGapLinked: true,
  pageMode: "same",
  orientation: "portrait",
  customWidthMm: 210,
  customHeightMm: 297,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  // Session state: starts from the Live Preview preference, toggling it does not change the preference.
  live: sessionDefaults(usePreferencesStore.getState().prefs).live,
  snapshot: null,
  result: null,
  layoutError: null,
  setRows: (n) => set({ rows: clampCount(n) }),
  setColumns: (n) => set({ columns: clampCount(n) }),
  setGapX: (mm) => set((s) => (s.gapLinked ? { gapXMm: gap(mm), gapYMm: gap(mm) } : { gapXMm: gap(mm) })),
  setGapY: (mm) => set({ gapYMm: gap(mm) }),
  setSourceGapX: (mm) =>
    set((s) => (s.sourceGapLinked ? { sourceGapXMm: gap(mm), sourceGapYMm: gap(mm) } : { sourceGapXMm: gap(mm) })),
  setSourceGapY: (mm) => set({ sourceGapYMm: gap(mm) }),
  // Linking snaps the vertical value to the horizontal one.
  setGapLinked: (gapLinked) => set((s) => ({ gapLinked, ...(gapLinked && { gapYMm: s.gapXMm }) })),
  setSourceGapLinked: (sourceGapLinked) =>
    set((s) => ({ sourceGapLinked, ...(sourceGapLinked && { sourceGapYMm: s.sourceGapXMm }) })),
  setPageMode: (pageMode) => set({ pageMode }),
  setOrientation: (orientation) => set({ orientation }),
  setCustomSize: (w, h) =>
    set((s) => ({
      customWidthMm: w === undefined ? s.customWidthMm : Math.max(w, 10),
      customHeightMm: h === undefined ? s.customHeightMm : Math.max(h, 10),
    })),
  setMargin: (side, mm) => set((s) => ({ margins: { ...s.margins, [side]: margin(mm) } })),
  setLive: (live) => set({ live }),
  updatePreview: () => set((s) => ({ snapshot: s.result })),
  clearSnapshot: () => set({ snapshot: null }),
  setResult: (result, layoutError) => set({ result, layoutError }),
}));

type GridSettings = Pick<
  LayoutState,
  | "rows" | "columns" | "gapXMm" | "gapYMm" | "sourceGapXMm" | "sourceGapYMm"
  | "pageMode" | "orientation" | "customWidthMm" | "customHeightMm" | "margins"
>;

/** Output page in points for the explicit modes; null for `same` (and `fit`, which Rust sizes itself). */
function outputPage(s: GridSettings) {
  let size: { width: number; height: number } | null = null;
  if (s.pageMode === "a4" || s.pageMode === "letter" || s.pageMode === "legal") size = PAGE_PRESETS_MM[s.pageMode];
  else if (s.pageMode === "custom") size = { width: s.customWidthMm, height: s.customHeightMm };
  if (!size) return null;
  const [w, h] = s.orientation === "landscape" ? [size.height, size.width] : [size.width, size.height];
  return { width_pt: mmToPt(w), height_pt: mmToPt(h) };
}

/** The grid as the Rust layout engine / exporter expects it (snake_case). */
export function gridPayload(bounds: NormalizedRect, s: GridSettings): GridPayload {
  return {
    bounds,
    rows: s.rows,
    columns: s.columns,
    source_gap_x_mm: s.sourceGapXMm,
    source_gap_y_mm: s.sourceGapYMm,
    gap_x_mm: s.gapXMm,
    gap_y_mm: s.gapYMm,
    margin_top_mm: s.margins.top,
    margin_right_mm: s.margins.right,
    margin_bottom_mm: s.margins.bottom,
    margin_left_mm: s.margins.left,
    output_page: outputPage(s),
    fit_page: s.pageMode === "fit",
  };
}
