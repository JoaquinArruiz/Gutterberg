import { create } from "zustand";
import { clampCount } from "../lib/grid";
import type { LayoutResult } from "../lib/layout-api";

export const MAX_GAP_MM = 50;

/**
 * Layout/export settings. Currently one layout for the whole document; kept
 * separate from editor state so it can later be keyed by page range
 * (e.g. pages 1-10 = 3x3, pages 11-12 = 2x2).
 */
type LayoutState = {
  rows: number;
  columns: number;
  gapMm: number;
  /** Placements from the Rust layout engine for the current page; null if no selection or it doesn't fit. */
  result: LayoutResult | null;
  /** Why `result` is null despite a selection (e.g. the gap doesn't fit the page). */
  layoutError: string | null;
  setRows: (n: number) => void;
  setColumns: (n: number) => void;
  setGapMm: (mm: number) => void;
  setResult: (result: LayoutResult | null, error: string | null) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
  rows: 3,
  columns: 3,
  gapMm: 3,
  result: null,
  layoutError: null,
  setRows: (n) => set({ rows: clampCount(n) }),
  setColumns: (n) => set({ columns: clampCount(n) }),
  setGapMm: (mm) => set({ gapMm: Math.min(Math.max(mm, 0), MAX_GAP_MM) }),
  setResult: (result, layoutError) => set({ result, layoutError }),
}));
