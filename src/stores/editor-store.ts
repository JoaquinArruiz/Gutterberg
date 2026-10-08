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
import type { Detection } from "../lib/detect-api";
import type { AppError } from "../lib/errors";
import { sessionDefaults, type WorkspaceMode } from "../lib/preferences";
import type { PageSize } from "../lib/tauri";
import { usePreferencesStore } from "./preferences-store";

/** `select` edits the grid region, `card` draws and edits freeform cards one by one, `pan` moves the page. */
export type Tool = "select" | "card" | "pan";
/** The current workspace: "source" edits the card region, "output" previews the spaced-out page, "split" shows both. */
export type ViewMode = WorkspaceMode;

/** A detection shown as a draft on `page` of the PDF `documentId`; nothing in it is applied until the user says so. */
export type DetectionDraft = {
  documentId: number;
  page: number;
  detection: Detection;
  /** Which proposal is shown (they come best first). */
  index: number;
};

type EditorState = {
  viewport: ViewportState;
  /** While true the page is re-fitted whenever the viewport/page changes. */
  fitMode: boolean;
  tool: Tool;
  viewMode: ViewMode;
  /** The freeform card being edited, by page and index; session state, not part of undo. */
  selectedCard: { page: number; index: number } | null;
  /** The draft a detection left on the page, if any; session state, not saved and not part of undo. */
  draft: DetectionDraft | null;
  /** A detection is running. */
  detecting: boolean;
  /** Why the last detection failed. */
  detectError: AppError | null;

  fit: (box: Size, page: PageSize) => void;
  zoomBy: (factor: number, anchor: Point, page: PageSize) => void;
  zoomTo: (zoom: number, anchor: Point, page: PageSize) => void;
  panBy: (dx: number, dy: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTool: (t: Tool) => void;
  setSelectedCard: (card: { page: number; index: number } | null) => void;
  setDraft: (draft: DetectionDraft | null) => void;
  /** Show the next proposal of the draft (wraps round). */
  nextProposal: () => void;
  setDetecting: (detecting: boolean) => void;
  setDetectError: (error: AppError | null) => void;
  setViewMode: (m: ViewMode) => void;
  reset: () => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  fitMode: true,
  tool: "select",
  selectedCard: null,
  draft: null,
  detecting: false,
  detectError: null,
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
  setDraft: (draft) => set({ draft }),
  nextProposal: () =>
    set((s) =>
      s.draft
        ? { draft: { ...s.draft, index: (s.draft.index + 1) % Math.max(1, s.draft.detection.proposals.length) } }
        : s,
    ),
  setDetecting: (detecting) => set({ detecting }),
  setDetectError: (detectError) => set({ detectError }),
  setViewMode: (viewMode) => set({ viewMode }),
  reset: () => set({ fitMode: true }),
}));
