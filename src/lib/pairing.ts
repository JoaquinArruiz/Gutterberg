// Automatic front and back pairing: which piece is the back of which, found from where the pieces are in the
// source PDF (pages, rows and columns; freeform pieces by their order), so a whole game pairs in one click instead
// of one "Pick back…" per piece. Pure data over the pieces; the result goes into `CardEdits.backs` and the backs'
// turns, as one undo step (`PairBacksDialog`).

import { type CardId, cardIdKey } from "./card";
import type { CardEdits } from "./card-edits";
import type { Card, Turn } from "./sheet-api";

/**
 * How the backs sit in the file:
 * - `alternating`: fronts on one page, their backs on the next (page 1 with 2, 3 with 4…), as duplex files have.
 * - `afterFronts`: all the front pages first, then all the back pages in the same order.
 * - `beside`: on the same page, fronts in one half and backs in the other, as gutterfold files have.
 */
export const PAIRING_RULES = ["alternating", "afterFronts", "beside"] as const;
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
};

export const DEFAULT_PAIRING: PairingOptions = {
  rule: "alternating",
  mirrored: true,
  split: "columns",
  upsideDown: false,
};

/** What a rule found: the back of each front (key to key), and the pieces that are in no pair. */
export type Pairing = { backs: Record<string, string>; unpaired: string[] };

type Grid = Extract<CardId, { kind: "grid" }>;
type Freeform = Extract<CardId, { kind: "freeform" }>;

/** A source page's pieces: grid ones by row and column, freeform ones in their order. */
type Page = { grid: Card[]; freeform: Card[]; rows: number; columns: number };

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
  for (const { doc, cards: on } of [...byPage.values()].sort((a, b) => a.doc - b.doc || a.page - b.page)) {
    const g = on.filter((c) => c.id.kind === "grid");
    const page: Page = {
      grid: g,
      freeform: on.filter((c) => c.id.kind === "freeform").sort((a, b) => index(a) - index(b)),
      rows: Math.max(0, ...g.map((c) => grid(c).row + 1)),
      columns: Math.max(0, ...g.map((c) => grid(c).column + 1)),
    };
    byDocument.set(doc, [...(byDocument.get(doc) ?? []), page]);
  }
  return byDocument;
}

const index = (c: Card) => (c.id as Freeform).index;

/** The pairs between a page of fronts and a page of backs: by row and column, freeform pieces by order. */
function pairPages(front: Page, back: Page, mirrored: boolean, into: Record<string, string>) {
  const at = new Map(back.grid.map((c) => [`${grid(c).row}:${grid(c).column}`, c]));
  for (const f of front.grid) {
    const { row, column } = grid(f);
    const b = at.get(`${row}:${mirrored ? back.columns - 1 - column : column}`);
    if (b) into[key(f)] = key(b);
  }
  front.freeform.forEach((f, i) => {
    const b = back.freeform[i];
    if (b) into[key(f)] = key(b);
  });
}

/** The pairs within one page folded down the middle: each piece with the one it meets when the page is folded. */
function pairHalves(page: Page, split: PairingSplit, into: Record<string, string>) {
  const across = split === "columns" ? page.columns : page.rows;
  const at = new Map(page.grid.map((c) => [`${grid(c).row}:${grid(c).column}`, c]));
  for (const f of page.grid) {
    const { row, column } = grid(f);
    const n = split === "columns" ? column : row;
    if (n >= Math.floor(across / 2)) continue;
    const b = at.get(split === "columns" ? `${row}:${across - 1 - column}` : `${across - 1 - row}:${column}`);
    if (b) into[key(f)] = key(b);
  }
  // Freeform pieces: the first half of their order with the second half, in order.
  const half = Math.floor(page.freeform.length / 2);
  for (let i = 0; i < half; i++) into[key(page.freeform[i])] = key(page.freeform[half + i]);
}

/** Finds the back of every piece it can by `options.rule`. `cards` are the pieces of the library. */
export function pairPieces(cards: Card[], options: PairingOptions): Pairing {
  const backs: Record<string, string> = {};
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
  for (const back of Object.values(pairing.backs)) {
    if (upsideDown) turns[back] = 180 as Turn;
    else delete turns[back];
    delete backs[back]; // a back has no back of its own
  }
  return { ...edits, backs, turns };
}
