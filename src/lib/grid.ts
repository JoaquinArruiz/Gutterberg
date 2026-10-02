// Grid maths for the editor. Spacing/placement of the OUTPUT lives in the Rust
// layout engine (card_core::layout) and is not duplicated here: this file only
// answers "what do the source cards look like inside the selection".

import { clamp, type NormalizedRect } from "./coordinates";
import { MIN_SIZE } from "./selection";
import type { PageSize } from "./tauri";
import { ptToMm } from "./units";

export type GridSpec = { rows: number; columns: number };
export const MAX_GRID = 30;

export const clampCount = (n: number) => clamp(Math.round(n), 1, MAX_GRID);

const pageMm = (page: PageSize) => ({ width: ptToMm(page.width_pt), height: ptToMm(page.height_pt) });

/** Size in mm of one source card when `sel` is split into rows x columns. */
export function cardSizeMm(sel: NormalizedRect, page: PageSize, grid: GridSpec) {
  const p = pageMm(page);
  return { width: (sel.width * p.width) / grid.columns, height: (sel.height * p.height) / grid.rows };
}

/** Source card rects (normalized), row-major. */
export function cardRects(sel: NormalizedRect, grid: GridSpec): NormalizedRect[] {
  const w = sel.width / grid.columns;
  const h = sel.height / grid.rows;
  const out: NormalizedRect[] = [];
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.columns; c++) out.push({ x: sel.x + c * w, y: sel.y + r * h, width: w, height: h });
  return out;
}

/**
 * Resize the selection so each card is exactly `size` mm (either axis), keeping
 * the top-left corner. Clamped to the page.
 */
export function selectionForCardSize(
  sel: NormalizedRect,
  page: PageSize,
  grid: GridSpec,
  size: { width?: number; height?: number },
): NormalizedRect {
  const p = pageMm(page);
  const width = size.width === undefined ? sel.width : clamp((size.width * grid.columns) / p.width, MIN_SIZE, 1 - sel.x);
  const height = size.height === undefined ? sel.height : clamp((size.height * grid.rows) / p.height, MIN_SIZE, 1 - sel.y);
  return { ...sel, width, height };
}

/** Move the selection's top-left corner to (x, y) mm, keeping it inside the page. */
export function selectionAtMm(
  sel: NormalizedRect,
  page: PageSize,
  pos: { x?: number; y?: number },
): NormalizedRect {
  const p = pageMm(page);
  return {
    ...sel,
    x: pos.x === undefined ? sel.x : clamp(pos.x / p.width, 0, 1 - sel.width),
    y: pos.y === undefined ? sel.y : clamp(pos.y / p.height, 0, 1 - sel.height),
  };
}
