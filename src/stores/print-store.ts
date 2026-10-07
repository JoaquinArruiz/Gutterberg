import { create } from "zustand";
import { cardIdKey } from "../lib/card";
import {
  adjustQuantity,
  clickCard,
  EMPTY_SELECTION,
  type LibraryFilter,
  oneOfEach,
  pruneSelection,
  type Selection,
  setQuantity,
} from "../lib/library";
import {
  type CardOrder,
  DEFAULT_PLAN,
  MAX_SHEET_GRID,
  type PlanMode,
  type PrintPlan,
  type SheetGridMode,
} from "../lib/print-request";
import type { Card, OutputSheet } from "../lib/sheet-api";

const grid = (n: number) => Math.min(Math.max(Math.round(Number.isFinite(n) ? n : 1), 1), MAX_SHEET_GRID);

/**
 * The Print stage: what to print (the plan), which library cards are selected, and the cards and
 * sheets last computed by the Rust engine. The plan is session state for the open document.
 */
type PrintState = PrintPlan & {
  filter: LibraryFilter;
  selection: Selection;
  /** Every card of the page groups, in page order (`compute_cards`). */
  cards: Card[];
  cardsError: string | null;
  /** The sheets the plan produces (`compute_sheets`); null until computed. */
  sheets: OutputSheet[] | null;
  sheetsError: string | null;
  currentSheet: number;

  setMode: (mode: PlanMode) => void;
  /** Copies for `keys`. Changing a quantity switches to a custom selection (nothing else is printed). */
  setQuantity: (keys: string[], n: number) => void;
  adjustQuantity: (keys: string[], delta: number) => void;
  /** Custom selection starting from one copy of every card. */
  startFromAllCards: () => void;
  setAutoFill: (on: boolean) => void;
  setOrder: (order: CardOrder) => void;
  setGroupBySize: (on: boolean) => void;
  setSheetGrid: (mode: SheetGridMode) => void;
  setRows: (n: number) => void;
  setColumns: (n: number) => void;
  setFilter: (filter: LibraryFilter) => void;
  clickCard: (key: string, visible: string[], modifier: "none" | "toggle" | "range") => void;
  selectAll: (keys: string[]) => void;
  clearSelection: () => void;
  setCards: (cards: Card[], error: string | null) => void;
  setSheets: (sheets: OutputSheet[] | null, error: string | null) => void;
  setCurrentSheet: (i: number) => void;
  /** A new document: back to the default plan. */
  reset: () => void;
};

const initial = {
  ...DEFAULT_PLAN,
  filter: { kind: "all" } as LibraryFilter,
  selection: EMPTY_SELECTION,
  cards: [] as Card[],
  cardsError: null,
  sheets: null,
  sheetsError: null,
  currentSheet: 0,
};

export const usePrintStore = create<PrintState>((set) => ({
  ...initial,
  setMode: (mode) => set({ mode }),
  setQuantity: (keys, n) => set((s) => ({ mode: "custom", quantities: setQuantity(s.quantities, keys, n) })),
  adjustQuantity: (keys, delta) =>
    set((s) => ({ mode: "custom", quantities: adjustQuantity(s.quantities, keys, delta) })),
  startFromAllCards: () => set((s) => ({ mode: "custom", quantities: oneOfEach(s.cards) })),
  setAutoFill: (autoFill) => set({ autoFill }),
  setOrder: (order) => set({ order }),
  setGroupBySize: (groupBySize) => set({ groupBySize }),
  setSheetGrid: (sheetGrid) => set({ sheetGrid }),
  setRows: (n) => set({ rows: grid(n) }),
  setColumns: (n) => set({ columns: grid(n) }),
  setFilter: (filter) => set({ filter }),
  clickCard: (key, visible, modifier) => set((s) => ({ selection: clickCard(s.selection, key, visible, modifier) })),
  selectAll: (keys) => set({ selection: { selected: keys, anchor: keys[0] ?? null } }),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  setCards: (cards, cardsError) =>
    set((s) => ({
      cards,
      cardsError,
      selection: pruneSelection(s.selection, new Set(cards.map((c) => cardIdKey(c.id)))),
    })),
  setSheets: (sheets, sheetsError) =>
    set((s) => ({
      sheets,
      sheetsError,
      currentSheet: Math.min(s.currentSheet, Math.max(0, (sheets?.length ?? 1) - 1)),
    })),
  setCurrentSheet: (currentSheet) => set({ currentSheet }),
  reset: () => set({ ...initial }),
}));

/** The plan part of the state, for building a request. */
export const planOf = (s: PrintState): PrintPlan => ({
  mode: s.mode,
  quantities: s.quantities,
  autoFill: s.autoFill,
  order: s.order,
  groupBySize: s.groupBySize,
  sheetGrid: s.sheetGrid,
  rows: s.rows,
  columns: s.columns,
});
