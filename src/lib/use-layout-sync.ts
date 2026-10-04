import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { gridPayload, useLayoutStore } from "../stores/layout-store";
import { computeLayout } from "./layout-api";

/** Keeps the layout store's placements in sync with selection, grid, gap and page. */
export function useLayoutSync() {
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const selection = useEditorStore((s) => s.selection);
  const settings = useLayoutStore(
    useShallow((s) => ({
      rows: s.rows, columns: s.columns, gapXMm: s.gapXMm, gapYMm: s.gapYMm,
      sourceGapXMm: s.sourceGapXMm, sourceGapYMm: s.sourceGapYMm,
      pageMode: s.pageMode, orientation: s.orientation,
      customWidthMm: s.customWidthMm, customHeightMm: s.customHeightMm, margins: s.margins,
    })),
  );

  useEffect(() => {
    const { setResult } = useLayoutStore.getState();
    if (!page || !selection) return setResult(null, null);
    let stale = false;
    // Short debounce: selection drags fire this on every pointer move. The call
    // is pure geometry (no rendering), so it stays cheap.
    const t = setTimeout(() => {
      computeLayout(page, gridPayload(selection, settings))
        .then((r) => !stale && setResult(r, null))
        .catch((e) => !stale && setResult(null, String(e)));
    }, 16);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [page, selection, settings]);
}
