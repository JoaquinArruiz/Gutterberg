import { create } from "zustand";
import { clampCount } from "../lib/grid";

/**
 * Layout/export settings. Currently one layout for the whole document; kept
 * separate from editor state so it can later be keyed by page range
 * (e.g. pages 1-10 = 3x3, pages 11-12 = 2x2).
 */
type LayoutState = {
  rows: number;
  columns: number;
  gapMm: number; // edited in the spacing milestone
  setRows: (n: number) => void;
  setColumns: (n: number) => void;
};

export const useLayoutStore = create<LayoutState>((set) => ({
  rows: 3,
  columns: 3,
  gapMm: 3,
  setRows: (n) => set({ rows: clampCount(n) }),
  setColumns: (n) => set({ columns: clampCount(n) }),
}));
