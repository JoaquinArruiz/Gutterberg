import type { HintEventId } from "./hints";

// A tiny typed event bus. The stores and components call `emitHintEvent` where something happens
// (a selection is drawn, the stage changes, ...); a hint step with `advanceOn` listens, so it moves
// forward however the user did it (mouse, keyboard, typing a value).

const listeners = new Map<HintEventId, Set<() => void>>();

export function emitHintEvent(id: HintEventId) {
  for (const fn of [...(listeners.get(id) ?? [])]) fn();
}

/** Calls `fn` on every `id` event until the returned function is called. */
export function onHintEvent(id: HintEventId, fn: () => void): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(fn);
  listeners.set(id, set);
  return () => {
    set.delete(fn);
  };
}
