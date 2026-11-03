// The pages picked in the Pages panel with Ctrl/Cmd+click or Shift+click, to remove, skip or include together.
// Empty means just the viewed page. It is view state: not saved, not undone.

import { create } from "zustand";
import { useDocumentStore } from "./document-store";

type PageSelectionState = {
  /** Picked page indexes, ascending. */
  pages: number[];
  /** Adds `page` to the pick, or takes it out; `viewed` joins a pick that is starting. */
  toggle: (page: number, viewed: number) => void;
  /** Picks every page of `shown` from `from` to `to`, both included, in either order. */
  range: (from: number, to: number, shown: number[]) => void;
  clear: () => void;
};

export const usePageSelectionStore = create<PageSelectionState>((set) => ({
  pages: [],
  toggle: (page, viewed) =>
    set((s) => {
      const start = s.pages.length > 0 ? s.pages : page === viewed ? [] : [viewed];
      const pages = start.includes(page) ? start.filter((p) => p !== page) : [...start, page];
      return { pages: pages.sort((a, b) => a - b) };
    }),
  range: (from, to, shown) => {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    set({ pages: shown.filter((p) => p >= lo && p <= hi) });
  },
  clear: () => set((s) => (s.pages.length > 0 ? { pages: [] } : s)),
}));

/** The pages an action on `page` applies to: the pick when `page` is in it, else `page` alone. */
export function pagesFor(page: number): number[] {
  const { pages } = usePageSelectionStore.getState();
  return pages.includes(page) ? pages : [page];
}

// A pick belongs to one PDF: another document starts without one.
useDocumentStore.subscribe((s, prev) => {
  if (s.path !== prev.path) usePageSelectionStore.getState().clear();
});
