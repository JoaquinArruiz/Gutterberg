import { useEffect } from "react";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import { usePrintStore } from "../stores/print-store";
import { clearCardImages } from "./use-card-image";
import { startSession } from "./workspace";

/**
 * A document was opened: one default group over its pages, no history, the default print plan,
 * no cached card images, and the workspace and Live Preview start from the preferences. It lives
 * at the app level so it runs whichever stage is showing.
 */
export function useNewDocument() {
  const pages = useDocumentStore((s) => s.pages);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pages` is the trigger (a document was opened), not a value read
  useEffect(() => {
    useEditorStore.getState().reset();
    useLayoutStore.getState().resetDocument(useDocumentStore.getState().pages.length);
    useLayoutStore.getState().clearSnapshot();
    usePrintStore.getState().reset();
    clearCardImages();
    startSession();
  }, [pages]);
}
