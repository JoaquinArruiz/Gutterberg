import { create } from "zustand";
import {
  clamp,
  fitViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  type Point,
  type Size,
  type ViewportState,
  zoomAt,
} from "../lib/coordinates";
import type { PageSize } from "../lib/tauri";

const STEP = 1.25;
/** The space left round a fitted sheet, as the Source tab leaves round a page. */
export const SHEET_PAD = 24;

type SheetViewState = {
  /** The zoom and pan of the large sheet on the Print tab; null while it is fitted to the pane. */
  view: ViewportState | null;
  /** The pane and the sheet it shows, as last drawn: what the buttons and keys zoom. */
  box: Size;
  page: PageSize | null;
  setFrame: (box: Size, page: PageSize | null) => void;
  /** Zoom by `factor` keeping the point under `anchor` (pane px) still; the middle of the pane by default. */
  zoomBy: (factor: number, anchor?: Point) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  panBy: (dx: number, dy: number) => void;
  /** Back to the whole sheet in the pane. */
  fit: () => void;
};

/** Where the sheet is drawn: `view`, or fitted to the pane when there is none. */
export function sheetViewport(view: ViewportState | null, box: Size, page: PageSize): ViewportState {
  return view ?? fitViewport(box, page, SHEET_PAD);
}

/**
 * The zoom of the large sheet on the Print tab. Session state: it is kept while the user goes to the Source tab and
 * back, or to another sheet (to compare the same corner), and fitted again for a new project.
 */
export const useSheetViewStore = create<SheetViewState>((set, get) => ({
  view: null,
  box: { width: 0, height: 0 },
  page: null,
  setFrame: (box, page) => set({ box, page }),
  zoomBy: (factor, anchor) => {
    const { view, box, page } = get();
    if (!page || box.width <= 0) return;
    const vp = sheetViewport(view, box, page);
    const at = anchor ?? { x: box.width / 2, y: box.height / 2 };
    set({ view: zoomAt(vp, clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM), at, page) });
  },
  zoomIn: () => get().zoomBy(STEP),
  zoomOut: () => get().zoomBy(1 / STEP),
  panBy: (dx, dy) => {
    const { view, box, page } = get();
    if (!page || box.width <= 0) return;
    const vp = sheetViewport(view, box, page);
    set({ view: { ...vp, panX: vp.panX + dx, panY: vp.panY + dy } });
  },
  fit: () => set({ view: null }),
}));
