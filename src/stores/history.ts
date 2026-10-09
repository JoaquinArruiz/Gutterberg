// One undo history for the whole app. The layout (page groups, freeform pieces, turns and sizes, output settings)
// and the Print plan (copies and plan settings) are different stores, each with its own zundo timeline; this keeps
// the order in which their steps were made, so Ctrl+Z always undoes the last thing the user did, wherever it was
// done, and Ctrl+Shift+Z puts it back. Call `undo` / `redo` from here, not the layout store's own.

import { create } from "zustand";
import { endEdit, HISTORY_LIMIT, useLayoutStore } from "./layout-store";
import { usePrintStore } from "./print-store";

type Source = "layout" | "print";

/** The part of a zundo timeline this needs. */
type Timeline = {
  getState: () => { pastStates: unknown[]; futureStates: unknown[]; undo: () => void; redo: () => void };
  subscribe: (listener: (state: { pastStates: unknown[] }) => void) => () => void;
};

const timelines: Record<Source, Timeline> = { layout: useLayoutStore.temporal, print: usePrintStore.temporal };

/** Which store made each step, oldest first; `future` holds the undone ones, the next to redo last. */
let past: Source[] = [];
let future: Source[] = [];
/** True while this module is undoing or redoing, so the timelines' changes are not read as new steps. */
let applying = false;

/** Whether there is anything to undo or redo, for the toolbar buttons. */
export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>(() => ({ canUndo: false, canRedo: false }));
const publish = () => useHistory.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });

for (const source of Object.keys(timelines) as Source[]) {
  let newest = timelines[source].getState().pastStates.at(-1);
  timelines[source].subscribe((state) => {
    const latest = state.pastStates.at(-1);
    if (applying) {
      newest = latest;
    } else if (state.pastStates.length === 0) {
      // Cleared (another document, a project opened): its steps cannot be undone any more.
      past = past.filter((s) => s !== source);
      future = future.filter((s) => s !== source);
    } else if (latest !== newest) {
      // A new step. (A pause or resume, or a change that made no step, leaves the newest one as it was.)
      past = [...past, source].slice(-HISTORY_LIMIT);
      future = [];
    }
    newest = latest;
    publish();
  });
}

/** Runs `action` on a timeline without its changes counting as new steps. */
function apply(source: Source, action: "undo" | "redo") {
  applying = true;
  try {
    timelines[source].getState()[action]();
  } finally {
    applying = false;
  }
}

/** Takes back the last step made in any store. */
export function undo() {
  endEdit(); // a drag in progress is the newest step
  for (let source = past.pop(); source; source = past.pop()) {
    if (timelines[source].getState().pastStates.length === 0) continue; // nothing left to take back there
    apply(source, "undo");
    future = [...future, source];
    break;
  }
  publish();
}

/** Puts back the step `undo` took back last. */
export function redo() {
  endEdit();
  for (let source = future.pop(); source; source = future.pop()) {
    if (timelines[source].getState().futureStates.length === 0) continue;
    apply(source, "redo");
    past = [...past, source];
    break;
  }
  publish();
}

/** Forgets every step (tests, and a fresh start). */
export function clearHistory() {
  past = [];
  future = [];
  useLayoutStore.temporal.getState().clear();
  usePrintStore.temporal.getState().clear();
  publish();
}
