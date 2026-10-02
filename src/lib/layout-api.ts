import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { NormalizedRect } from "./coordinates";
import type { PageSize } from "./tauri";

// Mirrors card_core::layout::LayoutResult (serde, snake_case). Rects are in
// points, top-left origin.
const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const LayoutResultSchema = z.object({
  output_page: z.object({ width_pt: z.number(), height_pt: z.number() }),
  placements: z.array(z.object({ index: z.number().int(), source: RectSchema, destination: RectSchema })),
  card_width_mm: z.number(),
  card_height_mm: z.number(),
});
export type LayoutResult = z.infer<typeof LayoutResultSchema>;
export type CardPlacement = LayoutResult["placements"][number];

/** Asks the Rust layout engine (the one the exporter uses) for card placements. */
export async function computeLayout(
  sourcePage: PageSize,
  bounds: NormalizedRect,
  rows: number,
  columns: number,
  gapMm: number,
): Promise<LayoutResult> {
  const grid = { bounds, rows, columns, gap_mm: gapMm };
  return LayoutResultSchema.parse(await invoke("compute_layout", { sourcePage, grid }));
}
