// Snapping while something is dragged on the page (0.14.0): the edges and the middle of what moves are pulled onto
// the page's edges and middle and onto the edges of the other pieces and the grid region, when they come within a
// few screen pixels. Sticky edges (0.15.0) add the straight edges found in the artwork as targets, and make every
// snap sticky: a line that snapped stays until the pointer has moved a few pixels on. Everything is normalized to the
// page (0..1, top-left origin), like the rest of the UI geometry; the tolerance is given per axis, since one screen
// pixel is a different fraction of the width and of the height.

import type { OrientedRect } from "./card";
import type { NormalizedRect, Point } from "./coordinates";
import { cardCorners } from "./freeform";
import type { PageSize } from "./tauri";

/** How close (screen px) an edge has to come to a target to snap to it. */
export const SNAP_PX = 6;
/** How far (screen px) the pointer moves on from where a line snapped before the line lets go. */
export const RELEASE_PX = 10;

/** Positions along each axis: edges and middles of things, normalized. */
export type SnapLines = { xs: number[]; ys: number[] };

/** Where a drag snapped: the lines to show while it holds. */
export type Guides = SnapLines;

export const NO_GUIDES: Guides = { xs: [], ys: [] };

/** A straight edge in the artwork, normalized: at `at` across it, from `from` to `to` along it. */
export type EdgeLine = { at: number; from: number; to: number };
/** A page's edges: `xs` run down the page (each at an x), `ys` run across it (each at a y). */
export type EdgeLines = { xs: EdgeLine[]; ys: EdgeLine[] };

export const NO_EDGES: EdgeLines = { xs: [], ys: [] };

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

/**
 * The edges a box's sides can stick to. A vertical edge counts only if it runs along at least half of the box's left
 * or right side, and a horizontal one along half of its top or bottom, so art inside a piece never pulls a border.
 */
export function edgeTargets(box: NormalizedRect, edges: EdgeLines): SnapLines {
  const alongHalf = (e: EdgeLine, from: number, length: number) =>
    Math.min(e.to, from + length) - Math.max(e.from, from) >= length / 2 - EPS;
  return {
    xs: edges.xs.filter((e) => alongHalf(e, box.y, box.height)).map((e) => e.at),
    ys: edges.ys.filter((e) => alongHalf(e, box.x, box.width)).map((e) => e.at),
  };
}

/** Both sets of targets together. */
export const joinLines = (a: SnapLines, b: SnapLines): SnapLines => ({
  xs: [...a.xs, ...b.xs],
  ys: [...a.ys, ...b.ys],
});

/** The targets that line up with `moving` once it is shifted by `offset`, sorted. */
function lined(moving: number[], targets: number[], offset: number): number[] {
  const guides = targets.filter((t) => moving.some((m) => Math.abs(m + offset - t) < EPS));
  return [...new Set(guides)].sort((a, b) => a - b);
}

/** The closest pair of a moving line and a target within `tol`, leaving out the target `away`. */
function closest(
  moving: number[],
  targets: number[],
  tol: number,
  away: number | null = null,
): { line: number; target: number } | null {
  let best: { line: number; target: number; d: number } | null = null;
  moving.forEach((m, line) => {
    for (const target of targets) {
      if (away !== null && Math.abs(target - away) < EPS) continue;
      const d = Math.abs(target - m);
      if (d <= tol && (best === null || d < best.d)) best = { line, target, d };
    }
  });
  return best;
}

function snapAxis(moving: number[], targets: number[], tol: number): { offset: number; guides: number[] } {
  const best = closest(moving, targets, tol);
  if (best === null) return { offset: 0, guides: [] };
  const offset = best.target - moving[best.line];
  return { offset, guides: lined(moving, targets, offset) };
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

/** A moving line held on a target: which line (its index in the moving lines), the target, and where the pointer was. */
type Held = { line: number; target: number; pointer: number };
/**
 * One axis of a sticky snap: the line held, if any, and a target just let go of, which is not taken again until the
 * moving lines are clear of it (otherwise a line would snap straight back on).
 */
export type AxisStick = { held: Held | null; away: number | null };
/** What a sticky snap remembers between two pointer moves of one drag. */
export type Stick = { x: AxisStick; y: AxisStick };

export const FREE: Stick = { x: { held: null, away: null }, y: { held: null, away: null } };

function stickAxis(
  moving: number[],
  targets: number[],
  tol: number,
  release: number,
  pointer: number,
  state: AxisStick,
): { offset: number; guides: number[]; state: AxisStick } {
  let away = state.away;
  const held = state.held;
  if (held) {
    const line = moving[held.line];
    const stays =
      line !== undefined &&
      Math.abs(pointer - held.pointer) <= release &&
      targets.some((t) => Math.abs(t - held.target) < EPS);
    if (stays) {
      const offset = held.target - line;
      return { offset, guides: lined(moving, targets, offset), state: { held, away: null } };
    }
    away = held.target;
  }
  if (away !== null && moving.every((m) => Math.abs(m - (away as number)) > tol)) away = null;
  const best = closest(moving, targets, tol, away);
  if (best === null) return { offset: 0, guides: [], state: { held: null, away } };
  const offset = best.target - moving[best.line];
  return {
    offset,
    guides: lined(moving, targets, offset),
    state: { held: { ...best, pointer }, away: null },
  };
}

/**
 * [`snapOffset`], sticky: once a line has snapped it stays on its target until the pointer (normalized) has moved
 * more than `release` from where it was when the line snapped; then the line follows the pointer again. `state` is
 * what the previous move returned ([`FREE`] at the start of a drag).
 */
export function stickyOffset(
  moving: SnapLines,
  targets: SnapLines,
  tol: { x: number; y: number },
  release: { x: number; y: number },
  pointer: Point,
  state: Stick,
): { dx: number; dy: number; guides: Guides; state: Stick } {
  const x = stickAxis(moving.xs, targets.xs, tol.x, release.x, pointer.x, state.x);
  const y = stickAxis(moving.ys, targets.ys, tol.y, release.y, pointer.y, state.y);
  return { dx: x.offset, dy: y.offset, guides: { xs: x.guides, ys: y.guides }, state: { x: x.state, y: y.state } };
}
