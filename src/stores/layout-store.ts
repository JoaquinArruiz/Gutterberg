import { temporal } from "zundo";
import { create } from "zustand";
import { shallow } from "zustand/shallow";
import type { DocumentId, OrientedRect } from "../lib/card";
import {
  backsWithoutDocument,
  type CardEdits,
  editsAfterDelete,
  editsAfterRekey,
  editsAfterRemap,
  editsWithoutFreeform,
  isCardOfDocument,
  keyAfterGridDelete,
  NO_EDITS,
} from "../lib/card-edits";
import type { NormalizedRect } from "../lib/coordinates";
import type { DetectedGrid } from "../lib/detect";
import {
  activeIndex,
  activeRegion,
  addGrid,
  applyGridTo,
  clearGridRegion,
  defaultGroups,
  deleteGrid,
  type FreeformCards,
  type GridPatch,
  type GridRegion,
  gridGroupAt,
  groupAt,
  isSkipped,
  MAX_GAP_MM,
  MAX_GRIDS,
  newGridRegion,
  type PageGroup,
  patchGrid,
  setSkipped,
  updateGrid,
  updateGridGroup,
} from "../lib/document-layout";
import { type AppError, toAppErrorOrNull } from "../lib/errors";
import { gridToPieces } from "../lib/grid-to-pieces";
import { emitHintEvent } from "../lib/hint-events";
import type { LayoutResult } from "../lib/layout-api";
import { sessionDefaults } from "../lib/preferences";
import type { Card } from "../lib/sheet-api";
import type { GridPayload } from "../lib/tauri";
import { mmToPt } from "../lib/units";
import { useDocumentStore } from "./document-store";
import { usePreferencesStore } from "./preferences-store";

export { MAX_GAP_MM };
export const MAX_MARGIN_MM = 100;
const gap = (mm: number) => Math.min(Math.max(mm, 0), MAX_GAP_MM);
const margin = (mm: number) => Math.min(Math.max(mm, 0), MAX_MARGIN_MM);

export type PageMode = "same" | "a3" | "a4" | "a5" | "letter" | "legal" | "tabloid" | "custom" | "fit";
export type Orientation = "portrait" | "landscape";

export const PAGE_PRESETS_MM = {
  a3: { width: 297, height: 420 },
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
  /** Tabloid, 11 × 17 in; Ledger is the same sheet in landscape. */
  tabloid: { width: 279.4, height: 431.8 },
} as const;

/** The page sizes that are a fixed paper size. */
export type PresetPageMode = keyof typeof PAGE_PRESETS_MM;
export const isPresetPage = (m: PageMode): m is PresetPageMode => m in PAGE_PRESETS_MM;

type Margins = { top: number; right: number; bottom: number; left: number };

/** Where the pieces of one PDF are: its page groups and the pieces drawn one by one. */
export type DocLayout = { groups: PageGroup[]; freeform: FreeformCards };

/** Settings that shape the output sheet. Global for now; they move to the Print stage in M13. */
export type OutputSettings = {
  /** OUTPUT spacing between cards. */
  gapXMm: number;
  gapYMm: number;
  /** When linked, the vertical value follows the horizontal one. */
  gapLinked: boolean;
  /** Output page. `same` = source page size; `fit` = sized around the cards. */
  pageMode: PageMode;
  orientation: Orientation;
  customWidthMm: number;
  customHeightMm: number;
  margins: Margins;
};

export const DEFAULT_OUTPUT: OutputSettings = {
  gapXMm: 3,
  gapYMm: 3,
  gapLinked: true,
  pageMode: "same",
  orientation: "portrait",
  customWidthMm: 210,
  customHeightMm: 297,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
};

/** Just the output settings of any state that has them (a project file saves exactly these). */
export const outputSettings = (s: OutputSettings): OutputSettings => ({
  gapXMm: s.gapXMm,
  gapYMm: s.gapYMm,
  gapLinked: s.gapLinked,
  pageMode: s.pageMode,
  orientation: s.orientation,
  customWidthMm: s.customWidthMm,
  customHeightMm: s.customHeightMm,
  margins: s.margins,
});

/**
 * The document layout (page groups) plus the output settings. Everything here is one
 * undo step per edit; the derived `result`/`snapshot`/`layoutError` and the session flag
 * `live` are not part of history.
 *
 * Edits to a grid or its region take the page being viewed: they apply to the whole group
 * that page belongs to, and to the grid being edited there (`activeGrid`) unless they name one.
 */
type LayoutState = OutputSettings & {
  /** Page groups covering every page, in order. See `lib/document-layout.ts`. */
  groups: PageGroup[];
  /** Cards drawn one by one (the card tool), by page. A page can have these and a grid. */
  freeform: FreeformCards;
  /**
   * The layouts of the project's other PDFs, by document id. The PDF being edited keeps its own in `groups`
   * and `freeform`; switching swaps them, so every edit, drag and undo step works on one PDF at a time.
   */
  parked: Record<DocumentId, DocLayout>;
  /** Turn, scale and order the user gave the library's cards. */
  cardEdits: CardEdits;
  /**
   * The grid being edited on the viewed page, when its group has several (its place in the group's list). Session
   * state, outside undo; it goes back to the first grid when the page moves to another group, and is read through
   * `activeIndex`, so a number past the end means the last grid.
   */
  activeGrid: number;
  setActiveGrid: (n: number) => void;
  /** Live output preview for this session (initial value = Live Preview preference). */
  live: boolean;
  /** Result frozen by "Update preview" (manual mode). */
  snapshot: LayoutResult | null;
  /** Placements from the Rust layout engine for the current page; null if no region or the grid is invalid. */
  result: LayoutResult | null;
  /** Why `result` is null despite a region. */
  layoutError: AppError | null;
  /** A new document: one default group over all its pages, and no history. */
  resetDocument: (pageCount: number) => void;
  /**
   * Opens a whole project: the layout of the PDF being edited, the others parked, the output settings and
   * the per-piece edits. No history.
   */
  loadProject: (project: {
    active: DocLayout;
    parked: Record<DocumentId, DocLayout>;
    output: OutputSettings;
    edits: CardEdits;
  }) => void;
  /** Adds the layout of a PDF that was just added to the project; it stays parked until it is edited. */
  parkDocument: (id: DocumentId, layout: DocLayout) => void;
  /** Drops the PDF `id` from the project; `next` (parked) is taken up in its place when `id` was the one being edited. */
  removeDocument: (id: DocumentId, next: DocumentId | null) => void;
  /** Edit the PDF `to` instead of `from`: `from`'s layout is parked and `to`'s is taken up. No history. */
  switchDocument: (from: DocumentId, to: DocumentId) => void;
  setSelection: (page: number, r: NormalizedRect | null, grid?: number) => void;
  /** Adds a grid with no region to `page`'s group and makes it the one being edited, so the next drag draws it. */
  addGrid: (page: number) => void;
  /**
   * Deletes grid `n` of `page`'s group: its pieces leave the library, with their turn, size, order, backs and copies,
   * and the grids after it move up a place (their pieces' keys follow). The last grid only loses its region.
   */
  deleteGrid: (page: number, n: number) => void;
  /** Adds a freeform card to `page`; returns its index there (its identity in the library). */
  addFreeformCard: (page: number, card: OrientedRect) => number;
  updateFreeformCard: (page: number, index: number, card: OrientedRect) => void;
  /** Removes a freeform card; later cards move up, and their turn, scale and place in the order with them. */
  deleteFreeformCard: (page: number, index: number) => void;
  setCardEdits: (edits: CardEdits) => void;
  /** Sets the region and grid of the grid being edited in `page`'s group from a detected grid: one undo step. */
  applyDetectedGrid: (page: number, grid: DetectedGrid) => void;
  /**
   * Puts several detected grids in `page`'s group, one per grid: the ones the group has are replaced in order (their
   * pieces keep their keys) and the rest are added. One undo step.
   */
  applyDetectedGrids: (page: number, grids: DetectedGrid[]) => void;
  /** Replaces the freeform pieces of `page` with detected ones: one undo step. */
  applyDetectedPieces: (page: number, cards: OrientedRect[]) => void;
  /**
   * Turns the grid being edited in `page`'s group into freeform pieces, on this page only or on every page of the group: the cells
   * (`cards` are the engine's) become pieces at the same place and size, the region is cleared and the pieces' turn,
   * size, place in the order and backs follow. One undo step. Returns how many pieces were made.
   */
  turnGridIntoPieces: (page: number, onlyPage: boolean, cards: Card[]) => number;
  setGrid: (page: number, patch: GridPatch) => void;
  setSkipped: (page: number, skip: boolean) => void;
  /** Sets the skip state of several pages at once (page index to skipped): one undo step. */
  applySkips: (skips: Record<number, boolean>) => void;
  /** Copy the grid being edited (and its region) of `page`'s group onto `pages`, or every grid with `"all"`. */
  applyGrid: (page: number, pages: number[], which?: number | "all") => void;
  setGapX: (mm: number) => void;
  setGapY: (mm: number) => void;
  setGapLinked: (linked: boolean) => void;
  setPageMode: (m: PageMode) => void;
  setOrientation: (o: Orientation) => void;
  setCustomSize: (width?: number, height?: number) => void;
  setMargin: (side: keyof Margins, mm: number) => void;
  setLive: (live: boolean) => void;
  updatePreview: () => void;
  clearSnapshot: () => void;
  /** `error` is whatever the failed call rejected with (or null); it is kept as an `AppError`. */
  setResult: (result: LayoutResult | null, error: unknown) => void;
};

/** The part of the state that undo/redo records and restores. */
type Undoable = OutputSettings & { groups: PageGroup[]; freeform: FreeformCards; cardEdits: CardEdits };

const undoable = (s: LayoutState): Undoable => ({
  groups: s.groups,
  freeform: s.freeform,
  cardEdits: s.cardEdits,
  gapXMm: s.gapXMm,
  gapYMm: s.gapYMm,
  gapLinked: s.gapLinked,
  pageMode: s.pageMode,
  orientation: s.orientation,
  customWidthMm: s.customWidthMm,
  customHeightMm: s.customHeightMm,
  margins: s.margins,
});

export const HISTORY_LIMIT = 200;

// Deleting a freeform card renumbers the ones after it. The copies and selection in the Print stage are
// keyed by those numbers, so its store listens here and follows (undo does not bring them back).
const deletedListeners = new Set<(documentId: DocumentId, page: number, index: number) => void>();
export function onFreeformCardDeleted(fn: (documentId: DocumentId, page: number, index: number) => void): () => void {
  deletedListeners.add(fn);
  return () => {
    deletedListeners.delete(fn);
  };
}

// Deleting a grid renumbers the grids after it on the pages of its group: `to` says what became of each key (null:
// the piece is gone). The Print stage's copies, selection and common back follow.
const gridDeletedListeners = new Set<(to: (key: string) => string | null) => void>();
export function onGridDeleted(fn: (to: (key: string) => string | null) => void): () => void {
  gridDeletedListeners.add(fn);
  return () => {
    gridDeletedListeners.delete(fn);
  };
}

/** The region of grid `n` of `page`'s group. */
const regionOf = (groups: PageGroup[], page: number, n: number): GridRegion | undefined =>
  gridGroupAt(groups, page)?.grids[n];

// A grid turned into freeform pieces: the pieces have new keys. Copies and selection in the Print stage follow.
const movedListeners = new Set<(moves: Record<string, string>) => void>();
export function onCardKeysMoved(fn: (moves: Record<string, string>) => void): () => void {
  movedListeners.add(fn);
  return () => {
    movedListeners.delete(fn);
  };
}

export const useLayoutStore = create<LayoutState>()(
  temporal(
    (set, get) => ({
      groups: [],
      freeform: {},
      parked: {},
      cardEdits: NO_EDITS,
      ...DEFAULT_OUTPUT,
      activeGrid: 0,
      setActiveGrid: (activeGrid) => set({ activeGrid: Math.max(0, activeGrid) }),
      // Session state: starts from the Live Preview preference, toggling it does not change the preference.
      live: sessionDefaults(usePreferencesStore.getState().prefs).live,
      snapshot: null,
      result: null,
      layoutError: null,
      resetDocument: (pageCount) => {
        set({ groups: defaultGroups(pageCount), freeform: {}, parked: {}, cardEdits: NO_EDITS, activeGrid: 0 });
        useLayoutStore.temporal.getState().clear();
      },
      loadProject: ({ active, parked, output, edits }) => {
        set({ ...output, groups: active.groups, freeform: active.freeform, parked, cardEdits: edits, activeGrid: 0 });
        useLayoutStore.temporal.getState().clear();
      },
      parkDocument: (id, layout) => set((s) => ({ parked: { ...s.parked, [id]: layout } })),
      removeDocument: (id, next) => {
        const { parked, cardEdits } = get();
        const { [id]: _gone, ...rest } = parked;
        const target = next === null ? undefined : rest[next];
        const keep = (k: string) => !isCardOfDocument(k, id);
        const edits: CardEdits = {
          turns: Object.fromEntries(Object.entries(cardEdits.turns).filter(([k]) => keep(k))),
          scales: Object.fromEntries(Object.entries(cardEdits.scales).filter(([k]) => keep(k))),
          ...(cardEdits.scalesY
            ? { scalesY: Object.fromEntries(Object.entries(cardEdits.scalesY).filter(([k]) => keep(k))) }
            : {}),
          order: cardEdits.order.filter(keep),
          backs: backsWithoutDocument(cardEdits.backs, id),
        };
        if (next === null || !target) {
          set({ parked: rest, cardEdits: edits });
        } else {
          const { [next]: _taken, ...others } = rest;
          set({ parked: others, groups: target.groups, freeform: target.freeform, cardEdits: edits });
        }
        useLayoutStore.temporal.getState().clear();
      },
      switchDocument: (from, to) => {
        if (from === to) return;
        const { parked, groups, freeform } = get();
        const target = parked[to];
        if (!target) return;
        const { [to]: _taken, ...rest } = parked;
        set({
          parked: { ...rest, [from]: { groups, freeform } },
          groups: target.groups,
          freeform: target.freeform,
          activeGrid: 0,
        });
        useLayoutStore.temporal.getState().clear();
      },
      setSelection: (page, selection, grid) => {
        const n = grid ?? activeGridAt(get(), page);
        const created = selection !== null && (regionOf(get().groups, page, n)?.selection ?? null) === null;
        set((s) => ({ groups: updateGrid(s.groups, page, n, (r) => ({ ...r, selection })) }));
        if (created) emitHintEvent("selection-created");
      },
      addGrid: (page) => {
        const before = gridGroupAt(get().groups, page);
        if (!before || before.grids.length >= MAX_GRIDS) return;
        set((s) => ({ groups: addGrid(s.groups, page), activeGrid: before.grids.length }));
      },
      deleteGrid: (page, n) => {
        const group = gridGroupAt(get().groups, page);
        if (!group?.grids[n]) return;
        const documentId = useDocumentStore.getState().activeId;
        const to = (k: string) => keyAfterGridDelete(k, documentId, group.pages, n);
        // The last grid stays, without its region: its pieces go but nothing is renumbered.
        const last = group.grids.length === 1;
        const active = activeIndex(group, get().activeGrid);
        set((s) => ({
          groups: deleteGrid(s.groups, page, n),
          cardEdits: editsAfterRemap(s.cardEdits, to),
          activeGrid: last ? 0 : active > n ? active - 1 : Math.min(active, group.grids.length - 2),
        }));
        for (const fn of gridDeletedListeners) fn(to);
      },
      addFreeformCard: (page, card) => {
        const index = get().freeform[page]?.length ?? 0;
        set((s) => ({ freeform: { ...s.freeform, [page]: [...(s.freeform[page] ?? []), card] } }));
        return index;
      },
      updateFreeformCard: (page, index, card) =>
        set((s) => {
          const own = s.freeform[page];
          if (!own?.[index]) return s;
          return { freeform: { ...s.freeform, [page]: own.map((c, i) => (i === index ? card : c)) } };
        }),
      deleteFreeformCard: (page, index) => {
        const own = get().freeform[page];
        if (!own?.[index]) return;
        const rest = own.filter((_, i) => i !== index);
        const documentId = useDocumentStore.getState().activeId;
        set((s) => {
          const freeform = { ...s.freeform };
          if (rest.length > 0) freeform[page] = rest;
          else delete freeform[page];
          return { freeform, cardEdits: editsAfterDelete(s.cardEdits, documentId, page, index) };
        });
        for (const fn of deletedListeners) fn(documentId, page, index);
      },
      setCardEdits: (cardEdits) => set({ cardEdits }),
      applyDetectedGrid: (page, grid) => {
        const n = activeGridAt(get(), page);
        const created = (regionOf(get().groups, page, n)?.selection ?? null) === null;
        const { selection, ...fields } = grid;
        set((s) => ({
          groups: updateGrid(s.groups, page, n, (r) => ({ selection, grid: patchGrid(r.grid, fields) })),
        }));
        if (created) emitHintEvent("selection-created");
      },
      applyDetectedGrids: (page, detected) => {
        const group = gridGroupAt(get().groups, page);
        if (!group || detected.length === 0) return;
        const created = !group.grids.some((r) => r.selection !== null);
        const grids = detected.slice(0, MAX_GRIDS).map(({ selection, ...fields }, i): GridRegion => {
          const own = group.grids[i] ?? newGridRegion();
          return { selection, grid: patchGrid(own.grid, fields) };
        });
        // Grids past the detected ones keep their settings but lose their region: the page has what was found.
        const rest = group.grids.slice(grids.length).map((r) => ({ ...r, selection: null }));
        set((s) => ({
          groups: updateGridGroup(s.groups, page, (g) => ({ ...g, grids: [...grids, ...rest] })),
          activeGrid: 0,
        }));
        if (created) emitHintEvent("selection-created");
      },
      applyDetectedPieces: (page, cards) => {
        const old = get().freeform[page]?.length ?? 0;
        const documentId = useDocumentStore.getState().activeId;
        set((s) => {
          const freeform = { ...s.freeform };
          if (cards.length > 0) freeform[page] = cards;
          else delete freeform[page];
          return { freeform, cardEdits: editsWithoutFreeform(s.cardEdits, documentId, page, old) };
        });
        // The Print stage keys copies and the selection by piece number: the old pieces are gone.
        for (let i = 0; i < old; i++) for (const fn of deletedListeners) fn(documentId, page, 0);
      },
      turnGridIntoPieces: (page, onlyPage, cards) => {
        const { groups, freeform } = get();
        const group = gridGroupAt(groups, page);
        const doc = useDocumentStore.getState();
        const documentId = doc.activeId;
        const sizes = doc.pages;
        if (!group) return 0;
        const n = activeIndex(group, get().activeGrid);
        if (group.grids[n].selection === null) return 0;
        const pages = onlyPage
          ? [page]
          : Array.from({ length: group.pages.last - group.pages.first + 1 }, (_, i) => group.pages.first + i);
        const made = gridToPieces(cards, documentId, pages, sizes, freeform, n);
        const count = Object.values(made.pieces).reduce((n, list) => n + list.length, 0);
        if (count === 0) return 0;
        set((s) => {
          const next = { ...s.freeform };
          for (const [p, list] of Object.entries(made.pieces)) next[Number(p)] = [...(next[Number(p)] ?? []), ...list];
          return {
            groups: clearGridRegion(s.groups, page, onlyPage, n),
            freeform: next,
            cardEdits: editsAfterRekey(s.cardEdits, made.moves),
          };
        });
        for (const fn of movedListeners) fn(made.moves);
        return count;
      },
      setGrid: (page, patch) => {
        const n = activeGridAt(get(), page);
        set((s) => ({ groups: updateGrid(s.groups, page, n, (r) => ({ ...r, grid: patchGrid(r.grid, patch) })) }));
        emitHintEvent("grid-changed");
      },
      setSkipped: (page, skip) => set((s) => ({ groups: setSkipped(s.groups, page, skip) })),
      applySkips: (skips) =>
        set((s) => {
          let groups = s.groups;
          for (const [page, skip] of Object.entries(skips)) {
            if (isSkipped(groups, Number(page)) !== skip) groups = setSkipped(groups, Number(page), skip);
          }
          return groups === s.groups ? s : { groups };
        }),
      applyGrid: (page, pages, which) =>
        set((s) => ({ groups: applyGridTo(s.groups, page, pages, which ?? activeGridAt(s, page)) })),
      setGapX: (mm) => set((s) => (s.gapLinked ? { gapXMm: gap(mm), gapYMm: gap(mm) } : { gapXMm: gap(mm) })),
      setGapY: (mm) => set({ gapYMm: gap(mm) }),
      // Linking snaps the vertical value to the horizontal one.
      setGapLinked: (gapLinked) => set((s) => ({ gapLinked, ...(gapLinked && { gapYMm: s.gapXMm }) })),
      setPageMode: (pageMode) => set({ pageMode }),
      setOrientation: (orientation) => set({ orientation }),
      setCustomSize: (w, h) =>
        set((s) => ({
          customWidthMm: w === undefined ? s.customWidthMm : Math.max(w, 10),
          customHeightMm: h === undefined ? s.customHeightMm : Math.max(h, 10),
        })),
      setMargin: (side, mm) => set((s) => ({ margins: { ...s.margins, [side]: margin(mm) } })),
      setLive: (live) => set({ live }),
      updatePreview: () => set((s) => ({ snapshot: s.result })),
      clearSnapshot: () => set({ snapshot: null }),
      setResult: (result, error) => set({ result, layoutError: toAppErrorOrNull(error) }),
    }),
    {
      partialize: undoable,
      // Only changes to the undoable part make a step: `setResult`, `setLive` and friends do not.
      equality: shallow,
      limit: HISTORY_LIMIT,
    },
  ),
);

/**
 * Groups several edits into one undo step (a drag fires on every pointer move). Call
 * `beginEdit` when it starts and `endEdit` when it ends; both are safe to call twice.
 */
let openEdit: Undoable | null = null;

export function beginEdit() {
  if (openEdit) return;
  openEdit = undoable(useLayoutStore.getState());
  useLayoutStore.temporal.getState().pause();
}

export function endEdit() {
  if (!openEdit) return;
  const before = openEdit;
  openEdit = null;
  const history = useLayoutStore.temporal.getState();
  history.resume();
  if (shallow(before, undoable(useLayoutStore.getState()))) return;
  useLayoutStore.temporal.setState({
    pastStates: [...history.pastStates, before].slice(-HISTORY_LIMIT),
    futureStates: [],
  });
}

export function undo() {
  endEdit();
  useLayoutStore.temporal.getState().undo();
}

export function redo() {
  endEdit();
  useLayoutStore.temporal.getState().redo();
}

/** The number of the grid being edited in `page`'s group (0 when the page has no grid group). */
function activeGridAt(s: Pick<LayoutState, "groups" | "activeGrid">, page: number): number {
  const g = gridGroupAt(s.groups, page);
  return g ? activeIndex(g, s.activeGrid) : 0;
}

// The grid being edited goes back to the first when the viewed page moves to another group.
useDocumentStore.subscribe((s, prev) => {
  if (s.currentPage === prev.currentPage) return;
  const { groups, activeGrid } = useLayoutStore.getState();
  if (activeGrid !== 0 && groupAt(groups, s.currentPage) !== groupAt(groups, prev.currentPage))
    useLayoutStore.setState({ activeGrid: 0 });
});

/** The group the viewed page belongs to. */
export function useCurrentGroup(): PageGroup | undefined {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => groupAt(s.groups, page));
}

/** The grid group the viewed page belongs to; undefined when the page is skipped. */
export function useCurrentGridGroup() {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => gridGroupAt(s.groups, page));
}

/** The number of the grid being edited on the viewed page. */
export function useActiveGrid(): number {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => activeGridAt(s, page));
}

/** The grid being edited on the viewed page (its settings and region); undefined when the page is skipped. */
export function useCurrentGrid(): GridRegion | undefined {
  const page = useDocumentStore((s) => s.currentPage);
  return useLayoutStore((s) => {
    const g = gridGroupAt(s.groups, page);
    return g ? activeRegion(g, s.activeGrid) : undefined;
  });
}

type GridSettings = Pick<
  OutputSettings,
  "gapXMm" | "gapYMm" | "pageMode" | "orientation" | "customWidthMm" | "customHeightMm" | "margins"
>;

/** Output page in points for the explicit modes; null for `same` (and `fit`, which Rust sizes itself). */
export function outputPage(s: GridSettings) {
  let size: { width: number; height: number } | null = null;
  if (isPresetPage(s.pageMode)) size = PAGE_PRESETS_MM[s.pageMode];
  else if (s.pageMode === "custom") size = { width: s.customWidthMm, height: s.customHeightMm };
  if (!size) return null;
  const [w, h] = s.orientation === "landscape" ? [size.height, size.width] : [size.width, size.height];
  return { width_pt: mmToPt(w), height_pt: mmToPt(h) };
}

/** A group's grid and region plus the output settings, as the Rust layout engine / exporter expects them (snake_case). */
export function gridPayload(
  bounds: NormalizedRect,
  grid: { rows: number; columns: number; sourceGapXMm: number; sourceGapYMm: number },
  s: GridSettings,
): GridPayload {
  return {
    bounds,
    rows: grid.rows,
    columns: grid.columns,
    source_gap_x_mm: grid.sourceGapXMm,
    source_gap_y_mm: grid.sourceGapYMm,
    gap_x_mm: s.gapXMm,
    gap_y_mm: s.gapYMm,
    margin_top_mm: s.margins.top,
    margin_right_mm: s.margins.right,
    margin_bottom_mm: s.margins.bottom,
    margin_left_mm: s.margins.left,
    output_page: outputPage(s),
    fit_page: s.pageMode === "fit",
  };
}

/** Region of the grid being edited on the viewed page, read outside React (pointer handlers). */
export function getCurrentSelection(): NormalizedRect | null {
  const s = useLayoutStore.getState();
  const g = gridGroupAt(s.groups, useDocumentStore.getState().currentPage);
  return g ? activeRegion(g, s.activeGrid).selection : null;
}

/** The regions of the other grids of the viewed page (not the one being edited), with their numbers. */
export function getOtherSelections(): { n: number; selection: NormalizedRect }[] {
  const s = useLayoutStore.getState();
  const g = gridGroupAt(s.groups, useDocumentStore.getState().currentPage);
  if (!g) return [];
  const active = activeIndex(g, s.activeGrid);
  return g.grids.flatMap((r, n) => (n !== active && r.selection ? [{ n, selection: r.selection }] : []));
}

/** Sets the region of the grid being edited on the viewed page (every page of the group). */
export function setCurrentSelection(r: NormalizedRect | null) {
  useLayoutStore.getState().setSelection(useDocumentStore.getState().currentPage, r);
}

/** The page ranges of every PDF whose grid group has more than one grid drawn, as "document:first:last" joined by commas. */
function severalGridRanges(s: Pick<LayoutState, "groups" | "parked">, activeId: DocumentId): string {
  const out: string[] = [];
  const add = (id: DocumentId, groups: PageGroup[]) => {
    for (const g of groups)
      if (g.kind === "grid" && g.grids.filter((r) => r.selection).length > 1)
        out.push(`${id}:${g.pages.first}:${g.pages.last}`);
  };
  add(activeId, s.groups);
  for (const [id, layout] of Object.entries(s.parked)) add(Number(id), layout.groups);
  return out.join(",");
}

/**
 * Whether a page has several grids drawn, for the piece references that then name the grid (`p3 · g1 · r1 c2`). The
 * answer is a function of the document and the page, which changes only when a grid group gains or loses grids.
 */
export function useSeveralGrids(): (documentId: DocumentId, page: number) => boolean {
  const activeId = useDocumentStore((s) => s.activeId);
  const ranges = useLayoutStore((s) => severalGridRanges(s, activeId));
  const list = ranges === "" ? [] : ranges.split(",").map((r) => r.split(":").map(Number));
  return (documentId, page) => list.some(([d, first, last]) => d === documentId && page >= first && page <= last);
}
