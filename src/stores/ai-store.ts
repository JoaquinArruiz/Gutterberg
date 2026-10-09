import { create } from "zustand";
import type { AiProvider } from "../lib/ai";
import type { AiTask, Estimate, PageLabel, Usage } from "../lib/ai-api";
import type { DocumentId } from "../lib/card";
import type { AppError } from "../lib/errors";

/** An AI action waiting for the user's yes: what would be sent, to whom, and what it would cost. */
export type AiRun = {
  task: "detect" | "sort";
  documentId: DocumentId;
  /** Pages sent (one for Detect). */
  pages: number[];
  estimate: Estimate;
  provider: AiProvider;
};

/** One page of the proposal Sort pages makes, as the user can still change it. */
export type SortRow = { page: number; label: PageLabel; confidence: number; skip: boolean };

/**
 * AI Mode's session state: what is waiting for confirmation, what is running, the last result and
 * what it used. Nothing here is saved, and nothing in it is applied to the project.
 */
type AiState = {
  /** The user asked not to be asked again before a single-page Detect, until the app is closed. */
  skipDetectConfirm: boolean;
  /** Working out the estimate. */
  estimating: boolean;
  confirm: AiRun | null;
  running: boolean;
  /** What went wrong, and in which action (each section shows only its own). */
  error: { task: AiTask; error: AppError } | null;
  /** What the last run used, and which action it was. */
  usage: { task: AiTask; tokens: Usage } | null;
  sort: { documentId: DocumentId; rows: SortRow[] } | null;

  setSkipDetectConfirm: (on: boolean) => void;
  setEstimating: (on: boolean) => void;
  setConfirm: (run: AiRun | null) => void;
  setRunning: (on: boolean) => void;
  setError: (task: AiTask, error: AppError | null) => void;
  setUsage: (task: AiTask, usage: Usage | null) => void;
  setSort: (sort: AiState["sort"]) => void;
  updateRow: (page: number, patch: Partial<Pick<SortRow, "label" | "skip">>) => void;
  /** Back to the start: no confirm, no run, no proposal, no error. */
  clear: () => void;
};

export const useAiStore = create<AiState>((set) => ({
  skipDetectConfirm: false,
  estimating: false,
  confirm: null,
  running: false,
  error: null,
  usage: null,
  sort: null,
  setSkipDetectConfirm: (skipDetectConfirm) => set({ skipDetectConfirm }),
  setEstimating: (estimating) => set({ estimating }),
  setConfirm: (confirm) => set({ confirm }),
  setRunning: (running) => set({ running }),
  setError: (task, error) => set({ error: error ? { task, error } : null }),
  setUsage: (task, tokens) => set({ usage: tokens ? { task, tokens } : null }),
  setSort: (sort) => set({ sort }),
  updateRow: (page, patch) =>
    set((s) =>
      s.sort
        ? {
            sort: {
              ...s.sort,
              rows: s.sort.rows.map((r) => (r.page === page ? { ...r, ...patch } : r)),
            },
          }
        : s,
    ),
  clear: () => set({ estimating: false, confirm: null, running: false, error: null, usage: null, sort: null }),
}));
