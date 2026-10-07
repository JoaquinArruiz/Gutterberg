// The project's PDFs seen together: each with its page sizes and where its pieces are. The Source tab
// edits one PDF at a time (its layout lives in the layout store's `groups` and `freeform`, the others
// are parked), the Print tab plans over all of them.

import { useMemo } from "react";
import type { OpenDocument } from "../stores/document-store";
import { useDocumentStore } from "../stores/document-store";
import { type DocLayout, useLayoutStore } from "../stores/layout-store";
import type { DocumentId } from "./card";
import type { LayoutDocument } from "./print-request";

/** The layout of each document: the active one's live layout, the others' parked ones. */
export function layoutDocuments(
  documents: OpenDocument[],
  activeId: DocumentId,
  active: DocLayout,
  parked: Record<DocumentId, DocLayout>,
): LayoutDocument[] {
  return documents.flatMap((d) => {
    const layout = d.id === activeId ? active : parked[d.id];
    return layout ? [{ id: d.id, pages: d.pages, groups: layout.groups, freeform: layout.freeform }] : [];
  });
}

/** [`layoutDocuments`] for the current state, read outside React. */
export function getLayoutDocuments(): LayoutDocument[] {
  const docs = useDocumentStore.getState();
  const { groups, freeform, parked } = useLayoutStore.getState();
  return layoutDocuments(docs.documents, docs.activeId, { groups, freeform }, parked);
}

/** [`layoutDocuments`] for components: redraws when a PDF is added or any layout changes. */
export function useLayoutDocuments(): LayoutDocument[] {
  const documents = useDocumentStore((s) => s.documents);
  const activeId = useDocumentStore((s) => s.activeId);
  const groups = useLayoutStore((s) => s.groups);
  const freeform = useLayoutStore((s) => s.freeform);
  const parked = useLayoutStore((s) => s.parked);
  return useMemo(
    () => layoutDocuments(documents, activeId, { groups, freeform }, parked),
    [documents, activeId, groups, freeform, parked],
  );
}

/** Page sizes by document id: what the sheet preview plans from. */
export const pagesById = (documents: LayoutDocument[]): Record<DocumentId, LayoutDocument["pages"]> =>
  Object.fromEntries(documents.map((d) => [d.id, d.pages]));
