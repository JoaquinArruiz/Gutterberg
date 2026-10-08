// AI Mode from the UI (M19): ask, confirm, run, and keep the answer as a proposal. Every action first
// works out what would be sent and waits for a yes; none changes the project. Applying a proposal is
// the user's choice, and for Sort pages it is `layout-store.applySkips`: one undo step.

import { useAiStore } from "../stores/ai-store";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { type AiTask, aiDetectPieces, aiEstimate, aiSortPages, skippedByDefault } from "./ai-api";
import { toAppError } from "./errors";

const ai = () => useAiStore.getState();

async function ask(task: AiTask, documentId: number, pages: number[]): Promise<void> {
  ai().setError(task, null);
  ai().setUsage(task, null);
  ai().setEstimating(true);
  try {
    const estimate = await aiEstimate(task, documentId, pages);
    const provider = usePreferencesStore.getState().prefs.ai.provider;
    ai().setConfirm({ task, documentId, pages, estimate, provider });
  } catch (e) {
    ai().setError(task, toAppError(e));
  } finally {
    ai().setEstimating(false);
  }
}

/** Detect pieces on the viewed page with the AI engine: confirm first, unless the user turned that off for the session. */
export async function askDetect(): Promise<void> {
  const { activeId, currentPage } = useDocumentStore.getState();
  useEditorStore.getState().setDraft(null);
  if (ai().skipDetectConfirm) return execute("detect", activeId, [currentPage]);
  return ask("detect", activeId, [currentPage]);
}

/** Label every page of the PDF being edited: always confirmed first. */
export async function askSort(): Promise<void> {
  const { activeId, pages } = useDocumentStore.getState();
  ai().setSort(null);
  return ask(
    "sort",
    activeId,
    pages.map((_, i) => i),
  );
}

async function execute(task: AiTask, documentId: number, pages: number[]): Promise<void> {
  ai().setRunning(true);
  ai().setError(task, null);
  try {
    if (task === "detect") {
      const { detection, usage } = await aiDetectPieces(documentId, pages[0]);
      // The user moved on while it ran: the answer is for a page no longer in front of them.
      const now = useDocumentStore.getState();
      if (now.activeId !== documentId || now.currentPage !== pages[0]) return;
      useEditorStore.getState().setDraft({ documentId, page: pages[0], detection, index: 0 });
      ai().setUsage(task, usage);
    } else {
      const { labels, usage } = await aiSortPages(documentId, pages);
      if (useDocumentStore.getState().activeId !== documentId) return;
      const rows = labels.map((l) => ({
        page: l.page_index,
        label: l.label,
        confidence: l.confidence,
        skip: skippedByDefault(l.label),
      }));
      ai().setSort({ documentId, rows });
      ai().setUsage(task, usage);
    }
  } catch (e) {
    ai().setError(task, toAppError(e));
  } finally {
    ai().setRunning(false);
  }
}

/** The user said yes to what the notice showed. */
export async function confirmRun(): Promise<void> {
  const run = ai().confirm;
  if (!run) return;
  ai().setConfirm(null);
  await execute(run.task, run.documentId, run.pages);
}

/** The user said no: nothing was sent. */
export function cancelRun(): void {
  ai().setConfirm(null);
}

/** Sets the skip state of every page the proposal covers, as it now stands in the list. One undo step. */
export function applySort(): void {
  const sort = ai().sort;
  if (!sort || sort.documentId !== useDocumentStore.getState().activeId) return;
  const skips: Record<number, boolean> = {};
  for (const r of sort.rows) skips[r.page] = r.skip;
  useLayoutStore.getState().applySkips(skips);
  ai().setSort(null);
}

export function discardSort(): void {
  ai().setSort(null);
}

// Moving to another PDF drops what was waiting; turning AI Mode off drops everything of it.
useDocumentStore.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId) {
    ai().setConfirm(null);
    ai().setSort(null);
  }
});
usePreferencesStore.subscribe((s, prev) => {
  if (prev.prefs.ai.enabled && !s.prefs.ai.enabled) ai().clear();
  if (s.prefs.ai.enabled !== prev.prefs.ai.enabled) void import("./ai-api").then((m) => m.syncAiGate());
});
