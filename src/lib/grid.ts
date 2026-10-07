// Grid maths for the editor. Spacing/placement of the OUTPUT lives in the Rust
// layout engine (card_core::layout) and is not duplicated here: this file only
// answers "what do the source cards look like inside the selection".

import { clamp, type NormalizedRect } from "./coordinates";
import { MIN_SIZE } from "./selection";
import type { PageSize } from "./tauri";
import { ptToMm } from "./units";

/** Source grid: `gapXMm`/`gapYMm` is the spacing already present between cards in the PDF. */
export type GridSpec = { rows: number; columns: number; gapXMm?: number; gapYMm?: number };
export const MAX_GRID = 30;

export const clampCount = (n: number) => clamp(Math.round(n), 1, MAX_GRID);

const pageMm = (page: PageSize) => ({ width: ptToMm(page.width_pt), height: ptToMm(page.height_pt) });

/** Size in mm of one source card when `sel` is split into rows x columns. */
export function cardSizeMm(sel: NormalizedRect, page: PageSize, grid: GridSpec) {
  const p = pageMm(page);
  const gx = grid.gapXMm ?? 0;
  const gy = grid.gapYMm ?? 0;
  return {
    width: (sel.width * p.width - gx * (grid.columns - 1)) / grid.columns,
    height: (sel.height * p.height - gy * (grid.rows - 1)) / grid.rows,
  };
}

/** Source card rects (normalized), row-major. */
export function cardRects(sel: NormalizedRect, grid: GridSpec, page: PageSize): NormalizedRect[] {
  const p = pageMm(page);
  const gx = (grid.gapXMm ?? 0) / p.width;
  const gy = (grid.gapYMm ?? 0) / p.height;
  const w = (sel.width - gx * (grid.columns - 1)) / grid.columns;
  const h = (sel.height - gy * (grid.rows - 1)) / grid.rows;
  const out: NormalizedRect[] = [];
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.columns; c++)
      out.push({ x: sel.x + c * (w + gx), y: sel.y + r * (h + gy), width: w, height: h });
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
  const gx = grid.gapXMm ?? 0;
  const gy = grid.gapYMm ?? 0;
  const width =
    size.width === undefined
      ? sel.width
      : clamp((size.width * grid.columns + gx * (grid.columns - 1)) / p.width, MIN_SIZE, 1 - sel.x);
  const height =
    size.height === undefined
      ? sel.height
      : clamp((size.height * grid.rows + gy * (grid.rows - 1)) / p.height, MIN_SIZE, 1 - sel.y);
  return { ...sel, width, height };
}

/** Move the selection's top-left corner to (x, y) mm, keeping it inside the page. */
export function selectionAtMm(sel: NormalizedRect, page: PageSize, pos: { x?: number; y?: number }): NormalizedRect {
  const p = pageMm(page);
  return {
    ...sel,
    x: pos.x === undefined ? sel.x : clamp(pos.x / p.width, 0, 1 - sel.width),
    y: pos.y === undefined ? sel.y : clamp(pos.y / p.height, 0, 1 - sel.height),
  };
}
