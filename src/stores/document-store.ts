import { create } from "zustand";
import { openPdf, type PageSize, pickPdf } from "../lib/tauri";

type DocumentState = {
  path: string | null;
  pages: PageSize[]; // points; pages.length is the page count
  currentPage: number; // 0-based
  loading: boolean;
  error: string | null;
  openDialog: () => Promise<void>;
  setCurrentPage: (i: number) => void;
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  path: null,
  pages: [],
  currentPage: 0,
  loading: false,
  error: null,

  openDialog: async () => {
    try {
      const path = await pickPdf();
      if (!path) return;
      set({ loading: true, error: null });
      const info = await openPdf(path);
      set({ path, pages: info.pages, currentPage: 0, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setCurrentPage: (i) => {
    const n = get().pages.length;
    if (n > 0) set({ currentPage: Math.min(Math.max(i, 0), n - 1) });
  },
}));
