import { useEffect } from "react";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import { computeLayout } from "./layout-api";

/** Keeps the layout store's placements in sync with selection, grid, gap and page. */
export function useLayoutSync() {
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const selection = useEditorStore((s) => s.selection);
  const rows = useLayoutStore((s) => s.rows);
  const columns = useLayoutStore((s) => s.columns);
  const gapMm = useLayoutStore((s) => s.gapMm);

  useEffect(() => {
    const { setResult } = useLayoutStore.getState();
    if (!page || !selection) return setResult(null, null);
    let stale = false;
    // Debounced: selection drags fire this on every pointer move.
    const t = setTimeout(() => {
      computeLayout(page, selection, rows, columns, gapMm)
        .then((r) => !stale && setResult(r, null))
        .catch((e) => !stale && setResult(null, String(e)));
    }, 30);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [page, selection, rows, columns, gapMm]);
}
