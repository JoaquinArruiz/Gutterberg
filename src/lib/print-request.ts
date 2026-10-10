// The print stage's plan, and how it becomes the request the Rust planner takes. The plan only
// records what the user chose; where cards land is decided in Rust (`card_core::sheet`).

import { gridPayload, type OutputSettings, outputPage } from "../stores/layout-store";
import { cardIdKey, type DocumentId } from "./card";
import { applyEdits, type CardEdits, hasCardEdits, NO_EDITS } from "./card-edits";
import { orientedToPoints } from "./coordinates";
import type { FreeformCards, PageGroup } from "./document-layout";
import { DEFAULT_FINISH, type Finish, finishingPayload } from "./finish";
import type {
  Card,
  CardSetting,
  PaginateOptionsPayload,
  PrintLayoutPayload,
  PrintRequest,
  RustDocumentWithPages,
  RustGroup,
  SheetPagePayload,
} from "./sheet-api";
import type { PageSize } from "./tauri";

/** Every card once, in order (today's behaviour), or only the cards given a quantity. */
export type PlanMode = "all" | "custom";
/** `same`: each source page keeps its own grid. `auto`: as many per sheet as fit. `custom`: rows x columns. */
export type SheetGridMode = "same" | "auto" | "custom";
export type CardOrder = "grouped" | "interleaved";

export type PrintPlan = {
  mode: PlanMode;
  /** Copies per card (by `cardIdKey`) in custom mode; cards without an entry are not printed. */
  quantities: Record<string, number>;
  /** Repeat the cards until the last sheet is full. */
  autoFill: boolean;
  order: CardOrder;
  groupBySize: boolean;
  sheetGrid: SheetGridMode;
  rows: number;
  columns: number;
  /** Cut marks, bleed and duplex backs (M16). */
  finish: Finish;
};

export const DEFAULT_PLAN: PrintPlan = {
  mode: "all",
  quantities: {},
  autoFill: false,
  order: "grouped",
  groupBySize: true,
  sheetGrid: "same",
  rows: 3,
  columns: 3,
  finish: DEFAULT_FINISH,
};

export const MAX_QUANTITY = 99;
export const MAX_SHEET_GRID = 30;

/** One PDF of the project with where its pieces are: what the planner works from. */
export type LayoutDocument = {
  id: DocumentId;
  /** Page sizes in points. */
  pages: PageSize[];
  groups: PageGroup[];
  freeform: FreeformCards;
  /** Made of images (M24): its pages are the images themselves, so "same as source" makes no sense for it. */
  images?: boolean;
};

/**
 * Page groups in the Rust shape. Grid groups with no region drawn yet have no cards and are left out.
 * A page's freeform cards become a one-page freeform group right after that page's grid cards, so
 * the cards come out in page order.
 */
export function toRustGroups(
  groups: PageGroup[],
  pages: PageSize[],
  output: OutputSettings,
  freeform: FreeformCards = {},
): RustGroup[] {
  const out: RustGroup[] = [];
  for (const g of groups) {
    if (g.kind === "skip") {
      out.push({ pages: g.pages, kind: "skip" });
      continue;
    }
    const grid = g.selection ? gridPayload(g.selection, g.grid, output) : null;
    let start = g.pages.first;
    const flush = (end: number) => {
      if (grid && end >= start) out.push({ pages: { first: start, last: end }, kind: "grid", grid });
    };
    for (let p = g.pages.first; p <= g.pages.last; p++) {
      const own = freeform[p];
      const size = pages[p];
      if (!own?.length || !size) continue;
      flush(p);
      out.push({
        pages: { first: p, last: p },
        kind: "freeform",
        cards: own.map((c) => orientedToPoints(c, size)),
      });
      start = p + 1;
    }
    flush(g.pages.last);
  }
  return out;
}

/**
 * Whether the plan needs the card planner: freeform cards, cards turned, resized or reordered, or pieces of an images
 * document (whose source page is the image itself, so a sheet the size of the source would hold only that piece).
 */
export const plannerRequired = (cards: Card[], edits: CardEdits, imageDocuments?: ReadonlySet<DocumentId>): boolean =>
  cards.some((c) => c.id.kind === "freeform" || imageDocuments?.has(c.id.document_id)) || hasCardEdits(cards, edits);

/** The ids of the documents made of images: their pieces always go through the card planner. */
export const imageDocumentIds = (documents: Pick<LayoutDocument, "id" | "images">[]): Set<DocumentId> =>
  new Set(documents.filter((d) => d.images).map((d) => d.id));

/**
 * The sheet grid the plan really uses. "Same as source" is the default plan only (every card
 * once, in order, each source page on its own sheet), so any other plan falls back to Auto. `planner`
 * is true when cards are freeform, turned, resized or reordered (`plannerRequired`).
 */
export function effectiveGrid(plan: PrintPlan, planner = false): SheetGridMode {
  return plan.sheetGrid === "same" && (plan.mode !== "all" || plan.autoFill || planner) ? "auto" : plan.sheetGrid;
}

/**
 * The per-card settings the planner needs, in print order: in custom mode a quantity for every card (0 =
 * not printed); in "all cards" mode none, unless cards are turned, resized or reordered (`edited`), when
 * every card is listed once. `cards` carry the user's turn, scale and order (`applyEdits`).
 */
export function planSettings(plan: PrintPlan, cards: Card[], edited = false): CardSetting[] {
  if (plan.mode === "all" && !edited) return [];
  return cards.map((c) => ({
    id: c.id,
    quantity: plan.mode === "all" ? 1 : (plan.quantities[cardIdKey(c.id)] ?? 0),
    turn: c.turn,
    scale: c.scale,
  }));
}

function sheetPage(output: OutputSettings): SheetPagePayload {
  if (output.pageMode === "same") return { kind: "same_as_source" };
  if (output.pageMode === "fit") return { kind: "fit" };
  const size = outputPage(output);
  return size ? { kind: "size", ...size } : { kind: "same_as_source" };
}

/** The project's PDFs in the shape the Rust commands take (with the page sizes the preview plans from). */
export function toRustDocuments(documents: LayoutDocument[], output: OutputSettings): RustDocumentWithPages[] {
  return documents.map((d) => ({
    document_id: d.id,
    pages: d.pages,
    groups: toRustGroups(d.groups, d.pages, output, d.freeform),
  }));
}

export function buildPrintRequest(
  plan: PrintPlan,
  cards: Card[],
  documents: LayoutDocument[],
  output: OutputSettings,
  edits: CardEdits = NO_EDITS,
): PrintRequest {
  // `cards` are the engine's, in page order (one document after the other); the user's turns, scales and
  // order are applied here.
  const ordered = applyEdits(cards, edits);
  const edited = hasCardEdits(cards, edits);
  const grid = effectiveGrid(plan, plannerRequired(cards, edits, imageDocumentIds(documents)));
  const layout: PrintLayoutPayload =
    grid === "same"
      ? { kind: "same_as_source" }
      : {
          kind: "grid",
          spec: {
            page: sheetPage(output),
            rows: grid === "custom" ? plan.rows : null,
            columns: grid === "custom" ? plan.columns : null,
            gap_x_mm: output.gapXMm,
            gap_y_mm: output.gapYMm,
            margins: {
              top_mm: output.margins.top,
              right_mm: output.margins.right,
              bottom_mm: output.margins.bottom,
              left_mm: output.margins.left,
            },
          },
        };
  const options: PaginateOptionsPayload = {
    order: plan.order,
    group_by_size: plan.groupBySize,
    auto_fill: plan.autoFill,
  };
  return {
    documents: toRustDocuments(documents, output).map(({ pages: _pages, ...rest }) => rest),
    settings: planSettings(plan, ordered, edited),
    layout,
    options,
    finishing: finishingPayload(plan.finish, edits.backs, new Set(cards.map((c) => cardIdKey(c.id)))),
  };
}

/** How many copies the plan asks for (not counting auto-fill), for the summary line. */
export function requestedCopies(plan: PrintPlan, cards: Card[]): number {
  if (plan.mode === "all") return cards.length;
  return cards.reduce((n, c) => n + (plan.quantities[cardIdKey(c.id)] ?? 0), 0);
}
