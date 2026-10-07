import { create } from "zustand";
import type { AppError } from "../lib/errors";

/** The warnings worded from the catalog, under `project.notices`. */
export type NoticeKey = "pdfChanged" | "layoutReset";

/**
 * A message about opening or saving a project, shown under the toolbar until it is closed. Either a
 * warning (`key`, worded when drawn so changing the language updates it) or an error from the engine.
 */
export type ProjectNotice = {
  id: number;
  tone: "warning" | "error";
  key: NoticeKey | null;
  values: Record<string, string | number>;
  error: AppError | null;
};

type ProjectState = {
  /** The .gtr file the project was opened from or last saved to; null for a project not saved yet. */
  path: string | null;
  /** The content as of the last save or open: the project is modified while it differs. */
  signature: string | null;
  /** The project has changes that are not in `path`. */
  dirty: boolean;
  notices: ProjectNotice[];
  /** The project was opened from, or saved to, `path`; `signature` is what that file holds. */
  setSaved: (path: string | null, signature: string | null) => void;
  setDirty: (dirty: boolean) => void;
  addNotice: (key: NoticeKey, values?: Record<string, string | number>) => void;
  addError: (error: AppError) => void;
  dismissNotice: (id: number) => void;
  clearNotices: () => void;
};

let nextNotice = 1;

export const useProjectStore = create<ProjectState>((set) => ({
  path: null,
  signature: null,
  dirty: false,
  notices: [],
  setSaved: (path, signature) => set({ path, signature, dirty: false }),
  setDirty: (dirty) => set((s) => (s.dirty === dirty ? s : { dirty })),
  addNotice: (key, values = {}) =>
    set((s) => ({ notices: [...s.notices, { id: nextNotice++, tone: "warning", key, values, error: null }] })),
  addError: (error) =>
    set((s) => ({ notices: [...s.notices, { id: nextNotice++, tone: "error", key: null, values: {}, error }] })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clearNotices: () => set({ notices: [] }),
}));

/** The project's name as the user sees it: the file's name without `.gtr`, or null while unsaved. */
export const projectName = (path: string | null): string | null =>
  path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.gtr$/i, "") : null;
