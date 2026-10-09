import { create } from "zustand";

/** A button on a toast. It closes the toast too, unless `keep` is set. */
export type ToastAction = { label: string; onClick: () => void; keep?: boolean };

/** What a toast says. The texts are already in the user's language. */
export type ToastSpec = {
  title: string;
  text?: string;
  actions?: ToastAction[];
  /** The toast closes on its own after this many milliseconds (omitted: it stays until closed). */
  autoCloseMs?: number;
};

export type Toast = ToastSpec & { id: number };

let nextId = 1;

/**
 * The app's general toasts (help tips have their own, `HintToast`): one is shown at a time, the others wait
 * their turn in the order they came.
 */
export const useToastStore = create<{
  /** The first is on screen. */
  queue: Toast[];
  show: (spec: ToastSpec) => void;
  /** Closes the toast on screen (or the one with this id, wherever it is). */
  dismiss: (id?: number) => void;
}>((set) => ({
  queue: [],
  show: (spec) => set((s) => ({ queue: [...s.queue, { ...spec, id: nextId++ }] })),
  dismiss: (id) => set((s) => ({ queue: id === undefined ? s.queue.slice(1) : s.queue.filter((t) => t.id !== id) })),
}));
