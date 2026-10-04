import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import type { LayoutResult } from "./layout-api";
import type { PageSize } from "./tauri";

/**
 * The layout the output view shows: always current when Live Preview is on,
 * otherwise whatever "Update preview" last captured.
 */
export const usePreviewResult = (): LayoutResult | null =>
  useLayoutStore((s) => (s.live ? s.result : s.snapshot));

/** Page whose rect the main viewport pans/zooms: the output page in Output view, else the source page. */
export function activeViewPage(): PageSize | undefined {
  const doc = useDocumentStore.getState();
  const page = doc.pages[doc.currentPage];
  if (useEditorStore.getState().viewMode !== "output") return page;
  const l = useLayoutStore.getState();
  return (l.live ? l.result : l.snapshot)?.output_page ?? page;
}
