// Snapping while something is dragged on the page (0.14.0): the edges and the middle of what moves are pulled onto
// the page's edges and middle and onto the edges of the other pieces and the grid region, when they come within a
// few screen pixels. Everything is normalized to the page (0..1, top-left origin), like the rest of the UI geometry;
// the tolerance is given per axis, since one screen pixel is a different fraction of the width and of the height.

import type { OrientedRect } from "./card";
import type { NormalizedRect } from "./coordinates";
import { cardCorners } from "./freeform";
import type { PageSize } from "./tauri";

/** How close (screen px) an edge has to come to a target to snap to it. */
export const SNAP_PX = 6;

/** Positions along each axis: edges and middles of things, normalized. */
export type SnapLines = { xs: number[]; ys: number[] };

/** Where a drag snapped: the lines to show while it holds. */
export type Guides = SnapLines;

export const NO_GUIDES: Guides = { xs: [], ys: [] };

const EPS = 1e-7;

/** The upright box around a rectangle: its left, middle and right, its top, middle and bottom. */
export const rectLines = (r: NormalizedRect): SnapLines => ({
  xs: [r.x, r.x + r.width / 2, r.x + r.width],
  ys: [r.y, r.y + r.height / 2, r.y + r.height],
});

/** The upright box around a piece (a turned piece snaps by the box it fits in). */
export function cardBox(card: OrientedRect, page: PageSize): NormalizedRect {
  const corners = cardCorners(card, page);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** What can be snapped to: the page's edges and middle, and the lines of `others` (pieces, the grid region). */
export function snapTargets(others: NormalizedRect[]): SnapLines {
  const xs = [0, 0.5, 1];
  const ys = [0, 0.5, 1];
  for (const r of others) {
    const l = rectLines(r);
    xs.push(...l.xs);
    ys.push(...l.ys);
  }
  return { xs, ys };
}

/** The tolerance in page fractions for `px` screen pixels at `pxPerPt` screen pixels per point. */
export const snapTolerance = (page: PageSize, pxPerPt: number, px = SNAP_PX) => ({
  x: px / (page.width_pt * pxPerPt),
  y: px / (page.height_pt * pxPerPt),
});

function snapAxis(moving: number[], targets: number[], tol: number): { offset: number; guides: number[] } {
  let best: number | null = null;
  for (const m of moving)
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  if (best === null) return { offset: 0, guides: [] };
  const offset = best;
  const guides = targets.filter((t) => moving.some((m) => Math.abs(m + offset - t) < EPS));
  return { offset, guides: [...new Set(guides)].sort((a, b) => a - b) };
}

/**
 * The offset that brings the nearest of `moving`'s lines onto a target, on each axis on its own, within `tol`; 0 on
 * an axis where nothing is close enough. `guides` are the targets that line up once the offset is applied.
 */
export function snapOffset(
  moving: SnapLines,
  targets: SnapLines,
  tol: { x: number; y: number },
): { dx: number; dy: number; guides: Guides } {
  const x = snapAxis(moving.xs, targets.xs, tol.x);
  const y = snapAxis(moving.ys, targets.ys, tol.y);
  return { dx: x.offset, dy: y.offset, guides: { xs: x.guides, ys: y.guides } };
}
