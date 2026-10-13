// Turning a grid into freeform pieces: every cell of a page's grid becomes a freeform piece at the same place and
// size, so the page is free for the next grid. The cells come from the Rust engine (`compute_cards`), not from
// maths here; this file only files them as freeform pieces and says which key each one had and has.

import { cardIdKey, freeformCardId, type OrientedRect } from "./card";
import { orientedFromPoints } from "./coordinates";
import type { FreeformCards } from "./document-layout";
import type { Card } from "./sheet-api";
import type { PageSize } from "./tauri";

export type GridPieces = {
  /** The new freeform pieces by page, normalized to the page, to go after the page's own. */
  pieces: Record<number, OrientedRect[]>;
  /** The key of each grid piece (`cardIdKey`) and the key it has as a freeform piece. */
  moves: Record<string, string>;
};

const cellOrder = (a: Card, b: Card) =>
  a.id.kind === "grid" && b.id.kind === "grid" ? a.id.row - b.id.row || a.id.column - b.id.column : 0;

/**
 * The grid pieces of `pages` of document `documentId` as freeform pieces, row by row, after the `existing` ones of
 * each page. Pages without grid pieces are left out.
 */
export function gridToPieces(
  cards: Card[],
  documentId: number,
  pages: number[],
  sizes: PageSize[],
  existing: FreeformCards,
): GridPieces {
  const out: GridPieces = { pieces: {}, moves: {} };
  for (const page of pages) {
    const size = sizes[page];
    const cells = cards
      .filter((c) => c.id.kind === "grid" && c.id.document_id === documentId && c.id.page_index === page)
      .sort(cellOrder);
    if (!size || cells.length === 0) continue;
    const start = existing[page]?.length ?? 0;
    out.pieces[page] = cells.map((c) => orientedFromPoints(c.source, size));
    cells.forEach((c, i) => {
      out.moves[cardIdKey(c.id)] = cardIdKey(freeformCardId(documentId, page, start + i));
    });
  }
  return out;
}
