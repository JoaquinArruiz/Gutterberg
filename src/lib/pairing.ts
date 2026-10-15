// Automatic front and back pairing: which piece is the back of which, found from where the pieces are in the
// source PDF (pages, grids, rows and columns; freeform pieces by their order), so a whole game pairs in one click instead
// of one "Pick back…" per piece. Pure data over the pieces; the result goes into `CardEdits.backs` and the backs'
// turns, as one undo step (`PairBacksDialog`).

import { type CardId, cardIdKey, type DocumentId, gridNumber } from "./card";
import type { CardEdits } from "./card-edits";
import type { Card, Turn } from "./sheet-api";

/**
 * How the backs sit in the file:
 * - `alternating`: fronts on one page, their backs on the next (page 1 with 2, 3 with 4…), as duplex files have.
 * - `afterFronts`: all the front pages first, then all the back pages in the same order.
 * - `beside`: on the same page, fronts in one half and backs in the other, as gutterfold files have.
 * - `otherPdf`: the backs are another PDF of the project: page n of every other PDF with page n of that one.
 */
export const PAIRING_RULES = ["alternating", "afterFronts", "beside", "otherPdf"] as const;
export type PairingRule = (typeof PAIRING_RULES)[number];

/** For `beside`: where the fold is, between the left and right halves (`columns`) or the top and bottom (`rows`). */
export const PAIRING_SPLITS = ["columns", "rows"] as const;
export type PairingSplit = (typeof PAIRING_SPLITS)[number];

export type PairingOptions = {
  rule: PairingRule;
  /** Pages of backs: their columns run right to left, so a long-edge flip lands each back behind its front. */
  mirrored: boolean;
  split: PairingSplit;
  /** The backs are printed upside down in the file: they get a half turn, so they face like their fronts. */
  upsideDown: boolean;
  /** For `otherPdf`: the document that holds the backs. `null` = none chosen, so nothing pairs. */
  backsDocument: DocumentId | null;
  /** For `otherPdf`: a backs PDF that is one single piece is the back of every front, not of page 1 only. */
  commonBack: boolean;
};

export const DEFAULT_PAIRING: PairingOptions = {
  rule: "alternating",
  mirrored: true,
  split: "columns",
  upsideDown: false,
  backsDocument: null,
  commonBack: true,
};

/** What a rule found: the back of each front (key to key), and the pieces that are in no pair. */
export type Pairing = {
  backs: Record<string, string>;
  unpaired: string[];
  /** The one back that every front shares (`otherPdf` with a single-piece backs PDF); it is in no pair. */
  commonBack?: string;
};

type Grid = Extract<CardId, { kind: "grid" }>;
type Freeform = Extract<CardId, { kind: "freeform" }>;

/** How many rows and columns one grid of a page has, from its pieces. */
type GridSize = { rows: number; columns: number };

/**
 * A source page's pieces: grid ones by grid, row and column, freeform ones in their order. A page with several grids
 * pairs grid with grid: grid 2 of the fronts' page with grid 2 of the backs' page.
 */
type Page = { index: number; grid: Card[]; freeform: Card[]; grids: Map<number, GridSize> };

const key = (c: Card) => cardIdKey(c.id);
const grid = (c: Card) => c.id as Grid;

function pagesOf(cards: Card[]): Map<number, Page[]> {
  const byPage = new Map<string, { doc: number; page: number; cards: Card[] }>();
  for (const c of cards) {
    const k = `${c.id.document_id}:${c.id.page_index}`;
    const entry = byPage.get(k) ?? { doc: c.id.document_id, page: c.id.page_index, cards: [] };
    entry.cards.push(c);
    byPage.set(k, entry);
  }
  const byDocument = new Map<number, Page[]>();
  for (const { doc, page: pageIndex, cards: on } of [...byPage.values()].sort(
    (a, b) => a.doc - b.doc || a.page - b.page,
  )) {
    const g = on.filter((c) => c.id.kind === "grid");
    const grids = new Map<number, GridSize>();
    for (const c of g) {
      const size = grids.get(gridNumber(c.id)) ?? { rows: 0, columns: 0 };
      grids.set(gridNumber(c.id), {
        rows: Math.max(size.rows, grid(c).row + 1),
        columns: Math.max(size.columns, grid(c).column + 1),
      });
    }
    const page: Page = {
      index: pageIndex,
      grid: g,
      freeform: on.filter((c) => c.id.kind === "freeform").sort((a, b) => index(a) - index(b)),
      grids,
    };
    byDocument.set(doc, [...(byDocument.get(doc) ?? []), page]);
  }
  return byDocument;
}

const index = (c: Card) => (c.id as Freeform).index;

/** Where a grid piece is on its page: its grid, row and column. */
const cell = (n: number, row: number, column: number) => `${n}:${row}:${column}`;

/** The pairs between a page of fronts and a page of backs: grid by grid, by row and column, freeform pieces by order. */
function pairPages(front: Page, back: Page, mirrored: boolean, into: Record<string, string>) {
  const at = new Map(back.grid.map((c) => [cell(gridNumber(c.id), grid(c).row, grid(c).column), c]));
  for (const f of front.grid) {
    const { row, column } = grid(f);
    const n = gridNumber(f.id);
    const columns = back.grids.get(n)?.columns ?? 0;
    const b = at.get(cell(n, row, mirrored ? columns - 1 - column : column));
    if (b) into[key(f)] = key(b);
  }
  front.freeform.forEach((f, i) => {
    const b = back.freeform[i];
    if (b) into[key(f)] = key(b);
  });
}

/**
 * The pairs within one page folded down the middle: each piece with the one it meets when the page is folded. Each
 * grid of the page folds on its own.
 */
function pairHalves(page: Page, split: PairingSplit, into: Record<string, string>) {
  const at = new Map(page.grid.map((c) => [cell(gridNumber(c.id), grid(c).row, grid(c).column), c]));
  for (const f of page.grid) {
    const { row, column } = grid(f);
    const g = gridNumber(f.id);
    const size = page.grids.get(g) ?? { rows: 0, columns: 0 };
    const across = split === "columns" ? size.columns : size.rows;
    const n = split === "columns" ? column : row;
    if (n >= Math.floor(across / 2)) continue;
    const b = at.get(split === "columns" ? cell(g, row, across - 1 - column) : cell(g, across - 1 - row, column));
    if (b) into[key(f)] = key(b);
  }
  // Freeform pieces: the first half of their order with the second half, in order.
  const half = Math.floor(page.freeform.length / 2);
  for (let i = 0; i < half; i++) into[key(page.freeform[i])] = key(page.freeform[half + i]);
}

/** The pieces of `document`, when it is one single piece: the back that can be shared by every front. */
export function lonePiece(cards: Card[], document: DocumentId | null): string | null {
  const own = cards.filter((c) => c.id.document_id === document);
  return own.length === 1 ? key(own[0]) : null;
}

/**
 * The pairs between the PDFs: page n of every PDF but the backs one with page n of the backs one (the page's
 * number in the file, so a skipped page does not shift the others). A single-piece backs PDF is the common back.
 */
function pairAcrossDocuments(cards: Card[], options: PairingOptions, into: Record<string, string>): string | null {
  const doc = options.backsDocument;
  if (doc === null) return null;
  const shared = options.commonBack ? lonePiece(cards, doc) : null;
  if (shared) return cards.some((c) => c.id.document_id !== doc) ? shared : null;
  const byDocument = pagesOf(cards);
  const backPages = new Map((byDocument.get(doc) ?? []).map((p) => [p.index, p]));
  for (const [id, pages] of byDocument) {
    if (id === doc) continue;
    for (const front of pages) {
      const back = backPages.get(front.index);
      if (back) pairPages(front, back, options.mirrored, into);
    }
  }
  return null;
}

/** Finds the back of every piece it can by `options.rule`. `cards` are the pieces of the library. */
export function pairPieces(cards: Card[], options: PairingOptions): Pairing {
  const backs: Record<string, string> = {};
  if (options.rule === "otherPdf") {
    const commonBack = pairAcrossDocuments(cards, options, backs);
    const inPairs = new Set([...Object.keys(backs), ...Object.values(backs)]);
    const unpaired = cards.map(key).filter((k) => !inPairs.has(k));
    return commonBack ? { backs, unpaired: [], commonBack } : { backs, unpaired };
  }
  for (const pages of pagesOf(cards).values()) {
    if (options.rule === "alternating") {
      for (let i = 0; i + 1 < pages.length; i += 2) pairPages(pages[i], pages[i + 1], options.mirrored, backs);
    } else if (options.rule === "afterFronts") {
      const half = Math.floor(pages.length / 2);
      for (let i = 0; i < half; i++) pairPages(pages[i], pages[half + i], options.mirrored, backs);
    } else {
      for (const page of pages) pairHalves(page, options.split, backs);
    }
  }
  const inPairs = new Set([...Object.keys(backs), ...Object.values(backs)]);
  return { backs, unpaired: cards.map(key).filter((k) => !inPairs.has(k)) };
}

/**
 * The edits with the pairing applied: each front gets its back, and each back a half turn when the backs are
 * upside down (or its turn cleared when they are not), and no back of its own. Pieces the pairing does not name
 * keep what they had.
 */
export function applyPairing(edits: CardEdits, pairing: Pairing, upsideDown: boolean): CardEdits {
  const turns = { ...edits.turns };
  const backs = { ...edits.backs, ...pairing.backs };
  const shared = pairing.commonBack ? [pairing.commonBack] : [];
  for (const back of [...Object.values(pairing.backs), ...shared]) {
    if (upsideDown) turns[back] = 180 as Turn;
    else delete turns[back];
    delete backs[back]; // a back has no back of its own
  }
  return { ...edits, backs, turns };
}
