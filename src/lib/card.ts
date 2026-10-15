// Card identity and source geometry. Mirrors card_core::card (serde, snake_case); the sheet
// engine (M12) and the freeform card tool (M18) build on these types.

import { z } from "zod";
import { t } from "../i18n";

/** Which open PDF a card comes from. One document is open for now; sheets will mix several (M14). */
export type DocumentId = number;
export const DEFAULT_DOCUMENT_ID: DocumentId = 0;

const GridCardIdSchema = z.object({
  kind: z.literal("grid"),
  document_id: z.number().int(),
  page_index: z.number().int(),
  /** The grid's place among the page's grids (0 = the first). Rust leaves it out when it is 0. */
  grid: z.number().int().optional(),
  row: z.number().int(),
  column: z.number().int(),
});
const FreeformCardIdSchema = z.object({
  kind: z.literal("freeform"),
  document_id: z.number().int(),
  page_index: z.number().int(),
  index: z.number().int(),
});
export const CardIdSchema = z.discriminatedUnion("kind", [GridCardIdSchema, FreeformCardIdSchema]);

/** `grid`: a card cut from a grid group. `freeform`: a card drawn one by one (M18; nothing creates it yet). */
export type CardId = z.infer<typeof CardIdSchema>;

export const gridCardId = (
  documentId: DocumentId,
  pageIndex: number,
  row: number,
  column: number,
  grid = 0,
): CardId => ({
  kind: "grid",
  document_id: documentId,
  page_index: pageIndex,
  ...(grid > 0 ? { grid } : {}),
  row,
  column,
});

/** The number of the grid a piece comes from (0 for the first, and for freeform pieces). */
export const gridNumber = (id: CardId): number => (id.kind === "grid" ? (id.grid ?? 0) : 0);

export const freeformCardId = (documentId: DocumentId, pageIndex: number, index: number): CardId => ({
  kind: "freeform",
  document_id: documentId,
  page_index: pageIndex,
  index,
});

/**
 * A stable string for `id`, usable as a Map key or React key. A piece of a page's second or later grid has the grid's
 * number at the end (`g:0:2:1:0:1`); the first grid's pieces have none, so their keys are the ones they had before a
 * page could hold several grids.
 */
export const cardIdKey = (id: CardId): string =>
  id.kind === "grid"
    ? `g:${id.document_id}:${id.page_index}:${id.row}:${id.column}${id.grid ? `:${id.grid}` : ""}`
    : `f:${id.document_id}:${id.page_index}:${id.index}`;

/** What a piece key (`cardIdKey`) looks like: a document, a page and a place (and a grid number past the first). */
export const CARD_KEY = /^(?:g:\d+:\d+:\d+:\d+(?::[1-9]\d*)?|f:\d+:\d+:\d+)$/;

const PointSchema = z.object({ x: z.number(), y: z.number() });

/**
 * The area of a page a card is cut from: `width` x `height` centred on `center`, rotated
 * `angle_deg` clockwise (top-left origin). Grid cards always have an angle of 0.
 *
 * Which space the numbers are in depends on where it is held: the UI keeps them normalized
 * (centre and size as fractions of the page width and height, angle in degrees), and
 * `orientedToPoints` in `coordinates.ts` turns them into the points Rust expects.
 */
export const OrientedRectSchema = z.object({
  center: PointSchema,
  width: z.number(),
  height: z.number(),
  angle_deg: z.number(),
});
export type OrientedRect = z.infer<typeof OrientedRectSchema>;

/** The smallest axis-aligned box around `r` (same units as `r`): what a card image is cut from. */
export function orientedBounds(r: OrientedRect): { x: number; y: number; width: number; height: number } {
  const a = (r.angle_deg * Math.PI) / 180;
  const [sin, cos] = [Math.abs(Math.sin(a)), Math.abs(Math.cos(a))];
  const width = r.width * cos + r.height * sin;
  const height = r.width * sin + r.height * cos;
  return { x: r.center.x - width / 2, y: r.center.y - height / 2, width, height };
}

/**
 * Width in px of the crop of a source's bounding box when the card is shown in a `boxW` x `boxH` px box
 * (its final shape, after `turn`): the unturned card is as wide as the box's width, or its height for a
 * quarter turn, and the crop is wider than the card by the bounding box's ratio.
 */
export function cropWidthPx(source: OrientedRect, turn: number, boxW: number, boxH: number): number {
  const cardWidth = turn === 90 || turn === 270 ? boxH : boxW;
  return (orientedBounds(source).width / source.width) * cardWidth;
}

/**
 * The letter of a document in a project with several PDFs (A, B, C…, by its place in the project), so two pieces
 * that are both on page 1 at row 1 column 1 can be told apart. With one document there is none.
 */
export function documentLetter(documentIds: DocumentId[], documentId: DocumentId): string | null {
  const i = documentIds.indexOf(documentId);
  if (documentIds.length < 2 || i < 0) return null;
  return i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`;
}

/** The number (1-based) a grid piece's reference shows for its grid, or null when it shows none. */
const namedGrid = (id: CardId, severalGrids: boolean): number | null =>
  id.kind === "grid" && (severalGrids || gridNumber(id) > 0) ? gridNumber(id) + 1 : null;

/** Where a piece is on its page, as the library says it: `r1 c2`, `g2 · r1 c2` or `#2`. */
export function piecePosition(id: CardId, severalGrids = false): string {
  if (id.kind !== "grid") return t("library.thumb.freeformPosition", { n: id.index + 1 });
  const cell = t("library.thumb.gridPosition", { row: id.row + 1, column: id.column + 1 });
  const grid = namedGrid(id, severalGrids);
  return grid === null ? cell : `${t("library.thumb.gridNumber", { n: grid })} · ${cell}`;
}

/**
 * A piece's reference in the words of the piece library: `p3 · r1 c2` (grid) or `p4 · #2` (freeform), with the
 * document's letter in front when there is one: `A · p3 · r1 c2`. A piece of a page with several grids names its
 * grid: `p3 · g2 · r1 c2`. `severalGrids` says whether its page has several (the first grid's pieces carry no number
 * of their own). `short` is the position alone (`r1c2`, `g2 r1c2`, `#2`), for a place too small for the whole
 * reference.
 */
export function pieceReference(id: CardId, letter: string | null = null, short = false, severalGrids = false): string {
  if (short) {
    if (id.kind !== "grid") return t("library.thumb.freeformPosition", { n: id.index + 1 });
    const cell = t("library.thumb.gridShort", { row: id.row + 1, column: id.column + 1 });
    const grid = namedGrid(id, severalGrids);
    return grid === null ? cell : `${t("library.thumb.gridNumber", { n: grid })} ${cell}`;
  }
  const position = piecePosition(id, severalGrids);
  const label = t("library.thumb.label", { page: id.page_index + 1, position });
  return letter ? `${letter} · ${label}` : label;
}
