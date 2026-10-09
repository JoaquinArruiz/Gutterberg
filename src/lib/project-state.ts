// The open project as a project file would hold it, and the tracking that says whether it has changes
// that were not saved.

import { useEffect } from "react";
import { useDocumentStore } from "../stores/document-store";
import { outputSettings, useLayoutStore } from "../stores/layout-store";
import { planOf, usePrintStore } from "../stores/print-store";
import { useProjectStore } from "../stores/project-store";
import { getLayoutDocuments } from "./documents";
import { type ProjectDocumentState, type ProjectState, projectSignature } from "./project";

/** The project as it is now, or null while no PDF is open. */
export function currentProjectState(): ProjectState | null {
  const docs = useDocumentStore.getState();
  if (docs.documents.length === 0) return null;
  const layout = useLayoutStore.getState();
  const layouts = getLayoutDocuments();
  return {
    documents: docs.documents.flatMap((d) => {
      const own = layouts.find((l) => l.id === d.id);
      if (!own) return [];
      const viewedPage = d.id === docs.activeId ? docs.currentPage : (docs.viewed[d.id] ?? 0);
      const common = { id: d.id, pageCount: d.pages.length, groups: own.groups, freeform: own.freeform, viewedPage };
      const state: ProjectDocumentState = d.images
        ? {
            kind: "images",
            name: d.images.name,
            images: d.images.pages.map(({ path, hash, placement }) => ({ path, hash, placement })),
            ...common,
          }
        : { kind: "pdf", path: d.path, hash: d.hash, ...common };
      return [state];
    }),
    activeId: docs.activeId,
    output: outputSettings(layout),
    edits: layout.cardEdits,
    plan: planOf(usePrintStore.getState()),
  };
}

/** What a saved file would say; null while no PDF is open. */
export function currentSignature(): string | null {
  const state = currentProjectState();
  return state ? projectSignature(state) : null;
}

const DEBOUNCE_MS = 150;

/**
 * Keeps `project.dirty` true while the project differs from what was last saved or opened. Compares the
 * content (not the viewed page), so an edit that is undone, or made again identically, is not a change.
 */
export function useProjectTracking() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const { signature, setDirty } = useProjectStore.getState();
      const now = currentSignature();
      setDirty(now !== null && now !== signature);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(check, DEBOUNCE_MS);
    };
    const unsubscribe = [
      useDocumentStore.subscribe(schedule),
      useLayoutStore.subscribe(schedule),
      usePrintStore.subscribe(schedule),
      useProjectStore.subscribe((s, prev) => s.signature !== prev.signature && schedule()),
    ];
    return () => {
      clearTimeout(timer);
      for (const off of unsubscribe) off();
    };
  }, []);
}
