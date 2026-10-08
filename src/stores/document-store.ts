import { create } from "zustand";
import type { DocumentId } from "../lib/card";
import type { PageSize } from "../lib/tauri";

/** One PDF of the project, opened for rendering. */
export type OpenDocument = {
  id: DocumentId;
  path: string;
  /** Page sizes in points; `pages.length` is the page count. */
  pages: PageSize[];
  /** SHA-256 of the file (hex) when it was added to the project. */
  hash: string;
};

/**
 * The project's PDFs. The Source tab edits one of them at a time (`activeId`); `path`, `pages` and
 * `currentPage` always describe that one, so the page editor reads them without knowing about the others.
 */
type DocumentState = {
  documents: OpenDocument[];
  activeId: DocumentId;
  path: string | null;
  pages: PageSize[]; // points; pages.length is the page count
  currentPage: number; // 0-based
  /** The page last viewed in each document, so switching back returns to it. */
  viewed: Record<DocumentId, number>;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  /** Replaces the project's PDFs. `activeId` must be one of them. */
  setDocuments: (documents: OpenDocument[], activeId: DocumentId, viewed?: Record<DocumentId, number>) => void;
  /** Adds a PDF to the project without changing which one is being edited. */
  addDocument: (document: OpenDocument) => void;
  /** Edit another PDF; remembers the page left behind and returns to the one last viewed there. */
  setActive: (id: DocumentId) => void;
  /** Drops a PDF from the project. If it was being edited, the first remaining one takes its place. */
  removeDocument: (id: DocumentId) => void;
  clear: () => void;
  setCurrentPage: (i: number) => void;
};

const NONE = { documents: [] as OpenDocument[], activeId: 0, path: null, pages: [] as PageSize[], currentPage: 0 };

/** The fields that mirror the active document. */
function mirror(documents: OpenDocument[], activeId: DocumentId, page: number) {
  const active = documents.find((d) => d.id === activeId);
  if (!active) return NONE;
  return {
    documents,
    activeId,
    path: active.path,
    pages: active.pages,
    currentPage: Math.min(Math.max(page, 0), active.pages.length - 1),
  };
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  ...NONE,
  viewed: {},
  loading: false,

  setLoading: (loading) => set({ loading }),

  setDocuments: (documents, activeId, viewed = {}) =>
    set({ ...mirror(documents, activeId, viewed[activeId] ?? 0), viewed }),

  addDocument: (document) =>
    set((s) => ({
      documents: [...s.documents.filter((d) => d.id !== document.id), document],
      ...(s.documents.length === 0 ? mirror([document], document.id, 0) : {}),
    })),

  setActive: (id) => {
    const s = get();
    if (id === s.activeId || !s.documents.some((d) => d.id === id)) return;
    const viewed = { ...s.viewed, [s.activeId]: s.currentPage };
    set({ ...mirror(s.documents, id, viewed[id] ?? 0), viewed });
  },

  removeDocument: (id) => {
    const s = get();
    const documents = s.documents.filter((d) => d.id !== id);
    const { [id]: _gone, ...viewed } = s.viewed;
    if (documents.length === 0) return set({ ...NONE, viewed: {} });
    const activeId = id === s.activeId ? documents[0].id : s.activeId;
    set({ ...mirror(documents, activeId, activeId === s.activeId ? s.currentPage : (viewed[activeId] ?? 0)), viewed });
  },

  clear: () => set({ ...NONE, viewed: {} }),

  setCurrentPage: (i) => {
    const n = get().pages.length;
    if (n > 0) set({ currentPage: Math.min(Math.max(i, 0), n - 1) });
  },
}));

/** The PDF open under `id`, if any. */
export const documentById = (s: Pick<DocumentState, "documents">, id: DocumentId) =>
  s.documents.find((d) => d.id === id);

/** The next unused document id. */
export const nextDocumentId = (s: Pick<DocumentState, "documents">): DocumentId =>
  s.documents.reduce((max, d) => Math.max(max, d.id + 1), 0);

/** The last component of a path: the PDF's name as the user knows it. */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;
