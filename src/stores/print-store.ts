import { create } from "zustand";
import { cardIdKey } from "../lib/card";
import { isCardOfDocument, keyAfterDelete, remapRecord } from "../lib/card-edits";
import { type AppError, toAppErrorOrNull } from "../lib/errors";
import { cleanFinish, type Finish } from "../lib/finish";
import { emitHintEvent } from "../lib/hint-events";
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
import { onFreeformCardDeleted } from "./layout-store";

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
  cardsError: AppError | null;
  /** The sheets the plan produces (`compute_sheets`); null until computed. */
  sheets: OutputSheet[] | null;
  sheetsError: AppError | null;
  /** The sheets as of the last "refresh": what the preview shows while Live Preview is off. */
  sheetsSnapshot: OutputSheet[] | null;
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
  /** Cut marks, bleed and duplex settings; each part is merged in and pulled back into what the engine accepts. */
  setMarks: (patch: Partial<Finish["marks"]>) => void;
  setBleed: (patch: Partial<Finish["bleed"]>) => void;
  setDuplex: (patch: Partial<Finish["duplex"]>) => void;
  /** The piece picked in the library to choose a back for the selection; null = not choosing. */
  pickingBack: boolean;
  setPickingBack: (on: boolean) => void;
  setFilter: (filter: LibraryFilter) => void;
  clickCard: (key: string, visible: string[], modifier: "none" | "toggle" | "range") => void;
  selectAll: (keys: string[]) => void;
  clearSelection: () => void;
  /** `error` is whatever the failed call rejected with (or null); it is kept as an `AppError`. */
  setCards: (cards: Card[], error: unknown) => void;
  setSheets: (sheets: OutputSheet[] | null, error: unknown) => void;
  setCurrentSheet: (i: number) => void;
  /** Freeze the current sheets as the preview (the refresh button). */
  updateSheetsPreview: () => void;
  /** The Print stage was entered: forget the old sheets so the preview starts from a fresh plan. */
  beginPlanning: () => void;
  /** The name for the exported PDF (without ".pdf"); null = the default. */
  exportName: string | null;
  setExportName: (name: string | null) => void;
  /** A PDF left the project: its copies and selection go too. */
  forgetDocument: (documentId: number) => void;
  /** A new document: back to the default plan. */
  reset: () => void;
  /** Opens a saved plan (a project was opened). */
  loadPlan: (plan: PrintPlan) => void;
};

const initial = {
  ...DEFAULT_PLAN,
  filter: { kind: "all" } as LibraryFilter,
  selection: EMPTY_SELECTION,
  cards: [] as Card[],
  cardsError: null,
  sheets: null,
  sheetsError: null,
  sheetsSnapshot: null,
  currentSheet: 0,
  exportName: null as string | null,
  pickingBack: false,
};

export const usePrintStore = create<PrintState>((set) => ({
  ...initial,
  setMode: (mode) => set({ mode }),
  setQuantity: (keys, n) => {
    set((s) => ({ mode: "custom", quantities: setQuantity(s.quantities, keys, n) }));
    emitHintEvent("copies-changed");
  },
  adjustQuantity: (keys, delta) => {
    set((s) => ({ mode: "custom", quantities: adjustQuantity(s.quantities, keys, delta) }));
    emitHintEvent("copies-changed");
  },
  startFromAllCards: () => set((s) => ({ mode: "custom", quantities: oneOfEach(s.cards) })),
  setAutoFill: (autoFill) => set({ autoFill }),
  setOrder: (order) => set({ order }),
  setGroupBySize: (groupBySize) => set({ groupBySize }),
  setSheetGrid: (sheetGrid) => set({ sheetGrid }),
  setRows: (n) => set({ rows: grid(n) }),
  setColumns: (n) => set({ columns: grid(n) }),
  setMarks: (patch) => set((s) => ({ finish: cleanFinish({ ...s.finish, marks: { ...s.finish.marks, ...patch } }) })),
  setBleed: (patch) => set((s) => ({ finish: cleanFinish({ ...s.finish, bleed: { ...s.finish.bleed, ...patch } }) })),
  setDuplex: (patch) =>
    set((s) => ({ finish: cleanFinish({ ...s.finish, duplex: { ...s.finish.duplex, ...patch } }) })),
  setPickingBack: (pickingBack) => set({ pickingBack }),
  setFilter: (filter) => set({ filter }),
  clickCard: (key, visible, modifier) => set((s) => ({ selection: clickCard(s.selection, key, visible, modifier) })),
  selectAll: (keys) => set({ selection: { selected: keys, anchor: keys[0] ?? null } }),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  setCards: (cards, error) =>
    set((s) => ({
      cards,
      cardsError: toAppErrorOrNull(error),
      selection: pruneSelection(s.selection, new Set(cards.map((c) => cardIdKey(c.id)))),
    })),
  setSheets: (sheets, error) =>
    set((s) => ({
      sheets,
      sheetsError: toAppErrorOrNull(error),
      currentSheet: Math.min(s.currentSheet, Math.max(0, (sheets?.length ?? 1) - 1)),
    })),
  setCurrentSheet: (currentSheet) => set({ currentSheet }),
  updateSheetsPreview: () => set((s) => ({ sheetsSnapshot: s.sheets })),
  beginPlanning: () => set({ sheets: null, sheetsError: null, sheetsSnapshot: null }),
  setExportName: (exportName) => set({ exportName }),
  forgetDocument: (documentId) =>
    set((s) => ({
      finish: forgetCommonBack(s.finish, (k) => isCardOfDocument(k, documentId)),
      quantities: Object.fromEntries(Object.entries(s.quantities).filter(([k]) => !isCardOfDocument(k, documentId))),
      selection: {
        selected: s.selection.selected.filter((k) => !isCardOfDocument(k, documentId)),
        anchor:
          s.selection.anchor !== null && isCardOfDocument(s.selection.anchor, documentId) ? null : s.selection.anchor,
      },
    })),
  reset: () => set({ ...initial }),
  loadPlan: (plan) => set({ ...initial, ...plan }),
}));

// A freeform card was deleted and the later ones renumbered: their copies and selection move with them.
onFreeformCardDeleted((documentId, page, index) =>
  usePrintStore.setState((s) => {
    const kept = s.selection.selected.flatMap((k) => keyAfterDelete(k, documentId, page, index) ?? []);
    const anchor = s.selection.anchor === null ? null : keyAfterDelete(s.selection.anchor, documentId, page, index);
    const common = s.finish.duplex.commonBack;
    return {
      quantities: remapRecord(s.quantities, documentId, page, index),
      selection: { selected: kept, anchor },
      finish: common === null ? s.finish : withCommonBack(s.finish, keyAfterDelete(common, documentId, page, index)),
    };
  }),
);

const withCommonBack = (finish: Finish, commonBack: string | null): Finish => ({
  ...finish,
  duplex: { ...finish.duplex, commonBack },
});

/** The finish without its common back when `gone` says that piece left the project. */
const forgetCommonBack = (finish: Finish, gone: (key: string) => boolean): Finish =>
  finish.duplex.commonBack !== null && gone(finish.duplex.commonBack) ? withCommonBack(finish, null) : finish;

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
  finish: s.finish,
});
