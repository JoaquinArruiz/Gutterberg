// Card identity and source geometry. Mirrors card_core::card (serde, snake_case); the sheet
// engine (M12) and the freeform card tool (M18) build on these types.

import { z } from "zod";

/** Which open PDF a card comes from. One document is open for now; sheets will mix several (M14). */
export type DocumentId = number;
export const DEFAULT_DOCUMENT_ID: DocumentId = 0;

const GridCardIdSchema = z.object({
  kind: z.literal("grid"),
  document_id: z.number().int(),
  page_index: z.number().int(),
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

export const gridCardId = (documentId: DocumentId, pageIndex: number, row: number, column: number): CardId => ({
  kind: "grid",
  document_id: documentId,
  page_index: pageIndex,
  row,
  column,
});

export const freeformCardId = (documentId: DocumentId, pageIndex: number, index: number): CardId => ({
  kind: "freeform",
  document_id: documentId,
  page_index: pageIndex,
  index,
});

/** A stable string for `id`, usable as a Map key or React key. */
export const cardIdKey = (id: CardId): string =>
  id.kind === "grid"
    ? `g:${id.document_id}:${id.page_index}:${id.row}:${id.column}`
    : `f:${id.document_id}:${id.page_index}:${id.index}`;

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
