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
import { sessionDefaults, type WorkspaceMode } from "../lib/preferences";
import type { PageSize } from "../lib/tauri";
import { usePreferencesStore } from "./preferences-store";

/** `select` edits the grid region, `card` draws and edits freeform cards one by one, `pan` moves the page. */
export type Tool = "select" | "card" | "pan";
/** The current workspace: "source" edits the card region, "output" previews the spaced-out page, "split" shows both. */
export type ViewMode = WorkspaceMode;

type EditorState = {
  viewport: ViewportState;
  /** While true the page is re-fitted whenever the viewport/page changes. */
  fitMode: boolean;
  tool: Tool;
  viewMode: ViewMode;
  /** The freeform card being edited, by page and index; session state, not part of undo. */
  selectedCard: { page: number; index: number } | null;

  fit: (box: Size, page: PageSize) => void;
  zoomBy: (factor: number, anchor: Point, page: PageSize) => void;
  zoomTo: (zoom: number, anchor: Point, page: PageSize) => void;
  panBy: (dx: number, dy: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTool: (t: Tool) => void;
  setSelectedCard: (card: { page: number; index: number } | null) => void;
  setViewMode: (m: ViewMode) => void;
  reset: () => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  fitMode: true,
  tool: "select",
  selectedCard: null,
  // Session state: starts in the preferred workspace; switching never edits the preference.
  viewMode: sessionDefaults(usePreferencesStore.getState().prefs).viewMode,

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
  setSelectedCard: (selectedCard) => set({ selectedCard }),
  setViewMode: (viewMode) => set({ viewMode }),
  reset: () => set({ fitMode: true }),
}));
