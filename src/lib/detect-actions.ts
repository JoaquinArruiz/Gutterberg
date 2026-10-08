// Detecting pieces from the UI (M17): ask Rust, keep the answer as a draft on the page, and apply or
// drop it when the user says so. Detecting never changes the layout; only `applyDraft` does, and it
// is one undo step.

import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import { gridFromProposal, piecesFromProposal } from "./detect";
import { detectPieces } from "./detect-api";
import { toAppError } from "./errors";

/** Looks for pieces on the page being viewed and shows the best proposal as a draft. */
export async function runDetect(): Promise<void> {
  const { activeId, currentPage } = useDocumentStore.getState();
  const editor = useEditorStore.getState();
  editor.setDetectError(null);
  editor.setDraft(null);
  editor.setDetecting(true);
  try {
    const detection = await detectPieces(activeId, currentPage);
    // The user moved on while it ran: the answer is for a page that is no longer in front of them.
    const now = useDocumentStore.getState();
    if (now.activeId !== activeId || now.currentPage !== currentPage) return;
    useEditorStore.getState().setDraft({ documentId: activeId, page: currentPage, detection, index: 0 });
  } catch (e) {
    useEditorStore.getState().setDetectError(toAppError(e));
  } finally {
    useEditorStore.getState().setDetecting(false);
  }
}

/** The proposal the draft is showing, if there is one. */
export function shownProposal() {
  const { draft } = useEditorStore.getState();
  return draft ? (draft.detection.proposals[draft.index] ?? null) : null;
}

/** Applies the proposal on show to its page (a grid sets the region and grid; rectangles become freeform pieces). */
export function applyDraft(): void {
  const editor = useEditorStore.getState();
  const { draft } = editor;
  const proposal = shownProposal();
  if (!draft || !proposal) return;
  const { activeId, pages } = useDocumentStore.getState();
  const page = pages[draft.page];
  if (draft.documentId !== activeId || !page) return;
  const layout = useLayoutStore.getState();
  const grid = gridFromProposal(proposal, page);
  const pieces = piecesFromProposal(proposal, page);
  if (grid) layout.applyDetectedGrid(draft.page, grid);
  else if (pieces) {
    layout.applyDetectedPieces(draft.page, pieces);
    editor.setSelectedCard(null);
  }
  editor.setDraft(null);
}

export function discardDraft(): void {
  const editor = useEditorStore.getState();
  editor.setDraft(null);
  editor.setDetectError(null);
}

// A draft belongs to one page of one PDF and to the tool it was made in: moving away drops it.
useDocumentStore.subscribe((s, prev) => {
  if (s.currentPage !== prev.currentPage || s.activeId !== prev.activeId) discardDraft();
});
useEditorStore.subscribe((s, prev) => {
  if (s.tool !== prev.tool && s.draft) useEditorStore.getState().setDraft(null);
});
