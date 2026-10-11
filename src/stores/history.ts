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

/** Which stores made each step, oldest first (a `together` change lists every step it made in either store, in
 * order); `future` holds the undone ones, the next to redo last. */
let past: Source[][] = [];
let future: Source[][] = [];
/** True while this module is undoing or redoing, so the timelines' changes are not read as new steps. */
let applying = false;
/** The stores a `together` change has made steps in so far; null outside one. */
let grouping: Source[] | null = null;

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
      const without = (steps: Source[][]) => steps.map((s) => s.filter((x) => x !== source)).filter((s) => s.length);
      past = without(past);
      future = without(future);
    } else if (latest !== newest) {
      // A new step. (A pause or resume, or a change that made no step, leaves the newest one as it was.)
      if (grouping) {
        grouping.push(source);
      } else {
        past = [...past, [source]].slice(-HISTORY_LIMIT);
      }
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

/** Runs `change`, which may edit both stores, as a single undo step. */
export function together(change: () => void) {
  endEdit();
  grouping = [];
  try {
    change();
  } finally {
    const made = grouping;
    grouping = null;
    if (made.length > 0) past = [...past, made].slice(-HISTORY_LIMIT);
    publish();
  }
}

/** Takes back the last step made in any store. */
export function undo() {
  endEdit(); // a drag in progress is the newest step
  for (let step = past.pop(); step; step = past.pop()) {
    const done: Source[] = [];
    for (const source of [...step].reverse()) {
      if (timelines[source].getState().pastStates.length === 0) continue; // nothing left to take back there
      apply(source, "undo");
      done.unshift(source);
    }
    if (done.length === 0) continue;
    future = [...future, done];
    break;
  }
  publish();
}

/** Puts back the step `undo` took back last. */
export function redo() {
  endEdit();
  for (let step = future.pop(); step; step = future.pop()) {
    const done: Source[] = [];
    for (const source of step) {
      if (timelines[source].getState().futureStates.length === 0) continue;
      apply(source, "redo");
      done.push(source);
    }
    if (done.length === 0) continue;
    past = [...past, done];
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
