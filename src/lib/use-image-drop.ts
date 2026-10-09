import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useDocumentStore } from "../stores/document-store";
import { useImageImportStore } from "../stores/image-import-store";
import { addImagesDialog } from "./project-actions";

/** Files that are not PDFs or projects: anything else dropped is offered as images (and refused by name if it is not one). */
const droppable = (path: string) => !/\.(pdf|gtr)$/i.test(path);

/** Dropping image files on the window does what File › Add images does. PDFs are not taken from a drop. */
export function useImageDrop() {
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const files = event.payload.paths.filter(droppable);
          const busy = useDocumentStore.getState().loading || useImageImportStore.getState().pending !== null;
          if (files.length > 0 && !busy) void addImagesDialog(files);
        })
        .then((unlisten) => {
          if (live) off = unlisten;
          else unlisten();
        })
        .catch(() => {}); // outside the app window there is no webview to listen to
    } catch {
      // the same, where the Tauri bridge is missing altogether (tests)
    }
    return () => {
      live = false;
      off?.();
    };
  }, []);
}
