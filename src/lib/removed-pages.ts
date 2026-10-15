// Pages removed from view: skipped, out of the Pages panel and of page-by-page navigation, and brought back from the
// Removed pages list. The model is `SkipGroup.removed` in `document-layout.ts`.

import { useDocumentStore } from "../stores/document-store";
import { useLayoutStore } from "../stores/layout-store";
import { isRemoved, shownPage } from "./document-layout";

/** Removes `pages` from view, one undo step; at least one page always stays. Returns whether anything was removed. */
export function removePages(pages: number[]): boolean {
  const { groups } = useLayoutStore.getState();
  const total = useDocumentStore.getState().pages.length;
  const gone = new Set(pages);
  let left = 0;
  for (let p = 0; p < total; p++) if (!gone.has(p) && !isRemoved(groups, p)) left++;
  if (left === 0 || pages.every((p) => isRemoved(groups, p))) return false;
  useLayoutStore.getState().removePages(pages);
  return true;
}

/** Brings removed pages back, included, one undo step. */
export function restorePages(pages: number[]) {
  useLayoutStore.getState().restorePages(pages);
}

/** The next (1) or previous (-1) page in view: the arrow keys and Page Up/Down. */
export function stepPage(step: 1 | -1) {
  const doc = useDocumentStore.getState();
  doc.setCurrentPage(shownPage(useLayoutStore.getState().groups, doc.pages.length, doc.currentPage, step));
}

// The viewed page is never a removed one: removing it, or an undo, moves to the nearest page in view.
useLayoutStore.subscribe((s, prev) => {
  if (s.groups === prev.groups) return;
  const doc = useDocumentStore.getState();
  const to = shownPage(s.groups, doc.pages.length, doc.currentPage, 0);
  if (to !== doc.currentPage) doc.setCurrentPage(to);
});
