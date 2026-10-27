// The print stage's plan, and what the Rust planner builds the print request from. The plan only records what
// the user chose; the request (`card_core::print_request`) and where pieces land (`card_core::sheet`) are decided in
// Rust, for the preview, the export and the command line alike.

import type { OutputSettings } from "../stores/layout-store";
import { cardIdKey, type DocumentId } from "./card";
import { type CardEdits, hasCardEdits } from "./card-edits";
import type { FreeformCards, PageGroup } from "./document-layout";
import { DEFAULT_FINISH, type Finish } from "./finish";
import type { Card } from "./sheet-api";
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
 * is true when cards are freeform, turned, resized or reordered (`plannerRequired`). Only for what the Print inspector
 * shows: the request itself is built in Rust (`card_core::print_request::effective_grid`), with the same rule.
 */
export function effectiveGrid(plan: PrintPlan, planner = false): SheetGridMode {
  return plan.sheetGrid === "same" && (plan.mode !== "all" || plan.autoFill || planner) ? "auto" : plan.sheetGrid;
}

/** The output settings alone, from the layout store or anything holding them. */
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

/** A document in the project's shape, as `card_core::print_request::ProjectDocument` reads it. */
export type PrintDocument = { id: DocumentId; kind: "pdf" | "images"; groups: PageGroup[]; freeform: FreeformCards };

/** The parts of the project the request is built from (`card_core::print_request::PrintProject`): what is saved. */
export type PrintProject = {
  documents: PrintDocument[];
  output: OutputSettings;
  edits: CardEdits;
  plan: PrintPlan;
  /** The project's fills folder (Fill with AI), from where it is saved; null while it is not. */
  fillsDir: string | null;
};

/** The folder beside a project file that holds its Fill with AI pictures (`card_core::fill::fills_dir`). */
export const fillsDir = (projectPath: string | null): string | null => (projectPath ? `${projectPath}-fills` : null);

export const printDocuments = (documents: LayoutDocument[]): PrintDocument[] =>
  documents.map((d) => ({ id: d.id, kind: d.images ? "images" : "pdf", groups: d.groups, freeform: d.freeform }));

/** The project as Rust builds the print request from it, from the live stores' values. */
export function printProject(
  plan: PrintPlan,
  documents: LayoutDocument[],
  output: OutputSettings,
  edits: CardEdits,
  projectPath: string | null = null,
): PrintProject {
  return {
    documents: printDocuments(documents),
    output: outputSettings(output),
    edits,
    plan,
    fillsDir: fillsDir(projectPath),
  };
}

/** How many copies the plan asks for (not counting auto-fill), for the summary line. */
export function requestedCopies(plan: PrintPlan, cards: Card[]): number {
  if (plan.mode === "all") return cards.length;
  return cards.reduce((n, c) => n + (plan.quantities[cardIdKey(c.id)] ?? 0), 0);
}
