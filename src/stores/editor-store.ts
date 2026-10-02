import { create } from "zustand";
import {
  clamp, fitViewport, MAX_ZOOM, MIN_ZOOM, zoomAt,
  type NormalizedRect, type Point, type Size, type ViewportState,
} from "../lib/coordinates";
import type { PageSize } from "../lib/tauri";

export type Tool = "select" | "pan";

type EditorState = {
  viewport: ViewportState;
  /** While true the page is re-fitted whenever the viewport/page changes. */
  fitMode: boolean;
  tool: Tool;
  /** Card region, normalized to the page. The same region applies to every page for now. */
  selection: NormalizedRect | null;

  fit: (box: Size, page: PageSize) => void;
  zoomBy: (factor: number, anchor: Point, page: PageSize) => void;
  zoomTo: (zoom: number, anchor: Point, page: PageSize) => void;
  panBy: (dx: number, dy: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTool: (t: Tool) => void;
  setSelection: (r: NormalizedRect | null) => void;
  reset: () => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  fitMode: true,
  tool: "select",
  selection: null,

  fit: (box, page) => set({ viewport: fitViewport(box, page), fitMode: true }),
  zoomBy: (factor, anchor, page) => {
    const vp = get().viewport;
    set({ viewport: zoomAt(vp, clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM), anchor, page), fitMode: false });
  },
  zoomTo: (zoom, anchor, page) => set({ viewport: zoomAt(get().viewport, zoom, anchor, page), fitMode: false }),
  panBy: (dx, dy) => {
    const vp = get().viewport;
    set({ viewport: { ...vp, panX: vp.panX + dx, panY: vp.panY + dy }, fitMode: false });
  },
  setPan: (panX, panY) => set({ viewport: { ...get().viewport, panX, panY }, fitMode: false }),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  reset: () => set({ selection: null, fitMode: true }),
}));
