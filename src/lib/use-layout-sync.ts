import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore } from "../stores/document-store";
import { gridPayload, useCurrentGrid, useLayoutStore } from "../stores/layout-store";
import { computeLayout } from "./layout-api";

/**
 * Keeps the layout store's placements in sync with the grid being edited on the viewed page, the gap and the output
 * page: the Preview view shows that grid re-spaced (each grid of a page is its own sheet).
 */
export function useLayoutSync() {
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const current = useCurrentGrid();
  const selection = current?.selection;
  const grid = current?.grid;
  const settings = useLayoutStore(
    useShallow((s) => ({
      gapXMm: s.gapXMm,
      gapYMm: s.gapYMm,
      pageMode: s.pageMode,
      orientation: s.orientation,
      customWidthMm: s.customWidthMm,
      customHeightMm: s.customHeightMm,
      margins: s.margins,
    })),
  );

  useEffect(() => {
    const { setResult } = useLayoutStore.getState();
    if (!page || !selection || !grid) return setResult(null, null);
    let stale = false;
    // Short debounce: selection drags fire this on every pointer move. The call
    // is pure geometry (no rendering), so it stays cheap.
    const t = setTimeout(() => {
      computeLayout(page, gridPayload(selection, grid, settings))
        .then((r) => !stale && setResult(r, null))
        .catch((e) => !stale && setResult(null, e));
    }, 16);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [page, selection, grid, settings]);
}
