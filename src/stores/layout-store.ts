import { temporal } from "zundo";
import { create } from "zustand";
import { shallow } from "zustand/shallow";
import type { NormalizedRect } from "../lib/coordinates";
import {
  applyGridTo,
  defaultGroups,
  type GridPatch,
  gridGroupAt,
  groupAt,
  MAX_GAP_MM,
  type PageGroup,
  patchGrid,
  setSkipped,
  updateGridGroup,
} from "../lib/document-layout";
import { emitHintEvent } from "../lib/hint-events";
import type { LayoutResult } from "../lib/layout-api";
import { sessionDefaults } from "../lib/preferences";
import type { GridPayload } from "../lib/tauri";
import { mmToPt } from "../lib/units";
import { useDocumentStore } from "./document-store";
import { usePreferencesStore } from "./preferences-store";

export { MAX_GAP_MM };
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

/** Settings that shape the output sheet. Global for now; they move to the Print stage in M13. */
export type OutputSettings = {
  /** OUTPUT spacing between cards. */
  gapXMm: number;
  gapYMm: number;
  /** When linked, the vertical value follows the horizontal one. */
  gapLinked: boolean;
  /** Output page. `same` = source page size; `fit` = sized around the cards. */
  pageMode: PageMode;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  margins: Margins;
};

/**
 * The document layout (page groups) plus the output settings. Everything here is one
 * undo step per edit; the derived `result`/`snapshot`/`layoutError` and the session flag
 * `live` are not part of history.
 *
 * Edits to a grid or its region take the page being viewed: they apply to the whole group
 * that page belongs to.
 */
type LayoutState = OutputSettings & {
  /** Page groups covering every page, in order. See `lib/document-layout.ts`. */
  groups: PageGroup[];
  /** Live output preview for this session (initial value = Live Preview preference). */
  live: boolean;
  /** Result frozen by "Update preview" (manual mode). */
  snapshot: LayoutResult | null;
  /** Placements from the Rust layout engine for the current page; null if no region or the grid is invalid. */
  result: LayoutResult | null;
  /** Why `result` is null despite a region. */
  layoutError: string | null;
  /** A new document: one default group over all its pages, and no history. */
  resetDocument: (pageCount: number) => void;
  setSelection: (page: number, r: NormalizedRect | null) => void;
  setGrid: (page: number, patch: GridPatch) => void;
  setSkipped: (page: number, skip: boolean) => void;
  /** Copy the grid and region of `page`'s group onto `pages`. */
  applyGrid: (page: number, pages: number[]) => void;
  setGapX: (mm: number) => void;
  setGapY: (mm: number) => void;
  setGapLinked: (linked: boolean) => void;
  setPageMode: (m: PageMode) => void;
  setOrientation: (o: Orientation) => void;
  setCustomSize: (width?: number, height?: number) => void;
  setMargin: (side: keyof Margins, mm: number) => void;
  setLive: (live: boolean) => void;
  updatePreview: () => void;
  clearSnapshot: () => void;
  setResult: (result: LayoutResult | null, error: string | null) => void;
};

/** The part of the state that undo/redo records and restores. */
type Undoable = OutputSettings & { groups: PageGroup[] };

const undoable = (s: LayoutState): Undoable => ({
  groups: s.groups,
  gapXMm: s.gapXMm,
  gapYMm: s.gapYMm,
  gapLinked: s.gapLinked,
  pageMode: s.pageMode,
  orientation: s.orientation,
  customWidthMm: s.customWidthMm,
  customHeightMm: s.customHeightMm,
  margins: s.margins,
});

export const HISTORY_LIMIT = 200;

export const useLayoutStore = create<LayoutState>()(
  temporal(
    (set, get) => ({
      groups: [],
      gapXMm: 3,
      gapYMm: 3,
      gapLinked: true,
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
      resetDocument: (pageCount) => {
        set({ groups: defaultGroups(pageCount) });
        useLayoutStore.temporal.getState().clear();
      },
      setSelection: (page, selection) => {
        const created = selection !== null && (gridGroupAt(get().groups, page)?.selection ?? null) === null;
        set((s) => ({ groups: updateGridGroup(s.groups, page, (g) => ({ ...g, selection })) }));
        if (created) emitHintEvent("selection-created");
      },
      setGrid: (page, patch) => {
        set((s) => ({ groups: updateGridGroup(s.groups, page, (g) => ({ ...g, grid: patchGrid(g.grid, patch) })) }));
        emitHintEvent("grid-changed");
      },
      setSkipped: (page, skip) => set((s) => ({ groups: setSkipped(s.groups, page, skip) })),
      applyGrid: (page, pages) => set((s) => ({ groups: applyGridTo(s.groups, page, pages) })),
      setGapX: (mm) => set((s) => (s.gapLinked ? { gapXMm: gap(mm), gapYMm: gap(mm) } : { gapXMm: gap(mm) })),
      setGapY: (mm) => set({ gapYMm: gap(mm) }),
      // Linking snaps the vertical value to the horizontal one.
      setGapLinked: (gapLinked) => set((s) => ({ gapLinked, ...(gapLinked && { gapYMm: s.gapXMm }) })),
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
    }),
    {
      partialize: undoable,
      // Only changes to the undoable part make a step: `setResult`, `setLive` and friends do not.
      equality: shallow,
      limit: HISTORY_LIMIT,
    },
  ),
);

/**
 * Groups several edits into one undo step (a drag fires on every pointer move). Call
 * `beginEdit` when it starts and `endEdit` when it ends; both are safe to call twice.
 */
let openEdit: Undoable | null = null;

export function beginEdit() {
  if (openEdit) return;
  openEdit = undoable(useLayoutStore.getState());
  useLayoutStore.temporal.getState().pause();
}

export function endEdit() {
  if (!openEdit) return;
  const before = openEdit;
  openEdit = null;
  const history = useLayoutStore.temporal.getState();
  history.resume();
  if (shallow(before, undoable(useLayoutStore.getState()))) return;
  useLayoutStore.temporal.setState({
    pastStates: [...history.pastStates, before].slice(-HISTORY_LIMIT),
    futureStates: [],
  });
}

export function undo() {
  endEdit();
  useLayoutStore.temporal.getState().undo();
}

export function redo() {
  endEdit();
  useLayoutStore.temporal.getState().redo();
}

/** The group the viewed page belongs to. */
export function useCurrentGroup(): PageGroup | undefined {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => groupAt(s.groups, page));
}

/** The grid group the viewed page belongs to; undefined when the page is skipped. */
export function useCurrentGridGroup() {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => gridGroupAt(s.groups, page));
}

type GridSettings = Pick<
  OutputSettings,
  "gapXMm" | "gapYMm" | "pageMode" | "orientation" | "customWidthMm" | "customHeightMm" | "margins"
>;

/** Output page in points for the explicit modes; null for `same` (and `fit`, which Rust sizes itself). */
export function outputPage(s: GridSettings) {
  let size: { width: number; height: number } | null = null;
  if (s.pageMode === "a4" || s.pageMode === "letter" || s.pageMode === "legal") size = PAGE_PRESETS_MM[s.pageMode];
  else if (s.pageMode === "custom") size = { width: s.customWidthMm, height: s.customHeightMm };
  if (!size) return null;
  const [w, h] = s.orientation === "landscape" ? [size.height, size.width] : [size.width, size.height];
  return { width_pt: mmToPt(w), height_pt: mmToPt(h) };
}

/** A group's grid and region plus the output settings, as the Rust layout engine / exporter expects them (snake_case). */
export function gridPayload(
  bounds: NormalizedRect,
  grid: { rows: number; columns: number; sourceGapXMm: number; sourceGapYMm: number },
  s: GridSettings,
): GridPayload {
  return {
    bounds,
    rows: grid.rows,
    columns: grid.columns,
    source_gap_x_mm: grid.sourceGapXMm,
    source_gap_y_mm: grid.sourceGapYMm,
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

/** Region of the viewed page's grid group, read outside React (pointer handlers). */
export function getCurrentSelection(): NormalizedRect | null {
  return gridGroupAt(useLayoutStore.getState().groups, useDocumentStore.getState().currentPage)?.selection ?? null;
}

/** Sets the region of the viewed page's group (every page of the group). */
export function setCurrentSelection(r: NormalizedRect | null) {
  useLayoutStore.getState().setSelection(useDocumentStore.getState().currentPage, r);
}
