// Geometry for the card tool (M18): one oriented rectangle per card.
//
// Cards are held normalized to the page like every other UI geometry (see `card.ts`), but the
// angle is applied in point space, so every edit here goes through `orientedToPoints` /
// `orientedFromPoints` (`coordinates.ts`), works in points, and converts back. Pure functions:
// the viewport only forwards pointer positions.

import type { OrientedRect } from "./card";
import { clamp, orientedFromPoints, orientedToPoints, type Point } from "./coordinates";
import type { Handle } from "./selection";
import type { PageSize } from "./tauri";

/** What a pointer can grab on a selected card. */
export type CardHandle = Handle | "rotate";

/** Smallest card edge, in points (about 3 mm). */
export const MIN_CARD_PT = 8;
/** Angle step while Shift is held. */
export const SNAP_DEG = 15;
/** How far above the top edge the rotate handle sits, in screen px. */
export const ROTATE_HANDLE_PX = 24;

/** An angle in degrees as the equivalent one in (-180, 180]. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** `v` rotated clockwise (top-left origin, y down) by `deg`. */
function rotate(v: Point, deg: number): Point {
  const [sin, cos] = [Math.sin(rad(deg)), Math.cos(rad(deg))];
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

const toPt = (p: Point, page: PageSize): Point => ({ x: p.x * page.width_pt, y: p.y * page.height_pt });

/** A card drawn by dragging from `a` to `b` (normalized): upright, inside the page. */
export function drawCard(a: Point, b: Point, page: PageSize): OrientedRect {
  const [x0, x1] = [clamp(Math.min(a.x, b.x), 0, 1), clamp(Math.max(a.x, b.x), 0, 1)];
  const [y0, y1] = [clamp(Math.min(a.y, b.y), 0, 1), clamp(Math.max(a.y, b.y), 0, 1)];
  return orientedFromPoints(
    {
      center: { x: ((x0 + x1) / 2) * page.width_pt, y: ((y0 + y1) / 2) * page.height_pt },
      width: (x1 - x0) * page.width_pt,
      height: (y1 - y0) * page.height_pt,
      angle_deg: 0,
    },
    page,
  );
}

/** Too small to be a card: a click, not a drag. */
export function isTooSmall(r: OrientedRect, page: PageSize): boolean {
  return r.width * page.width_pt < MIN_CARD_PT || r.height * page.height_pt < MIN_CARD_PT;
}

/** Whether the normalized point `p` is inside the card (it is rotated into the card's own frame first). */
export function cardContains(r: OrientedRect, p: Point, page: PageSize): boolean {
  const c = orientedToPoints(r, page);
  const local = rotate({ x: toPt(p, page).x - c.center.x, y: toPt(p, page).y - c.center.y }, -c.angle_deg);
  return Math.abs(local.x) <= c.width / 2 && Math.abs(local.y) <= c.height / 2;
}

/** The card moved by (dx, dy) normalized, its centre kept on the page. */
export function moveCard(r: OrientedRect, dx: number, dy: number): OrientedRect {
  return { ...r, center: { x: clamp(r.center.x + dx, 0, 1), y: clamp(r.center.y + dy, 0, 1) } };
}

/**
 * Drag `handle` by (dx, dy) normalized. The drag is measured along the card's own edges, so a tilted
 * card resizes the way it looks. The opposite edge (or corner) stays where it is.
 */
export function resizeCard(r: OrientedRect, handle: Handle, dx: number, dy: number, page: PageSize): OrientedRect {
  const c = orientedToPoints(r, page);
  const d = rotate({ x: dx * page.width_pt, y: dy * page.height_pt }, -c.angle_deg);
  let [left, right, top, bottom] = [-c.width / 2, c.width / 2, -c.height / 2, c.height / 2];
  if (handle.includes("w")) left = Math.min(left + d.x, right - MIN_CARD_PT);
  if (handle.includes("e")) right = Math.max(right + d.x, left + MIN_CARD_PT);
  if (handle.includes("n")) top = Math.min(top + d.y, bottom - MIN_CARD_PT);
  if (handle.includes("s")) bottom = Math.max(bottom + d.y, top + MIN_CARD_PT);
  const shift = rotate({ x: (left + right) / 2, y: (top + bottom) / 2 }, c.angle_deg);
  return orientedFromPoints(
    {
      center: { x: c.center.x + shift.x, y: c.center.y + shift.y },
      width: right - left,
      height: bottom - top,
      angle_deg: c.angle_deg,
    },
    page,
  );
}

/** The card turned so its top edge points at `pointer` (normalized); Shift snaps to 15 degree steps. */
export function rotateCardTo(r: OrientedRect, pointer: Point, page: PageSize, snap: boolean): OrientedRect {
  const c = orientedToPoints(r, page);
  const p = toPt(pointer, page);
  const raw = (Math.atan2(p.x - c.center.x, -(p.y - c.center.y)) * 180) / Math.PI;
  return { ...r, angle_deg: normalizeAngle(snap ? Math.round(raw / SNAP_DEG) * SNAP_DEG : raw) };
}

/** The same card at another angle, about its centre. */
export const withAngle = (r: OrientedRect, deg: number): OrientedRect => ({ ...r, angle_deg: normalizeAngle(deg) });

/** Where `handle` sits on the card, normalized. `rotate` is `reach` points above the middle of the top edge. */
export function handlePosition(r: OrientedRect, handle: CardHandle, page: PageSize, reach = 0): Point {
  const c = orientedToPoints(r, page);
  const [hw, hh] = [c.width / 2, c.height / 2];
  const local =
    handle === "rotate"
      ? { x: 0, y: -hh - reach }
      : {
          x: handle.includes("w") ? -hw : handle.includes("e") ? hw : 0,
          y: handle.includes("n") ? -hh : handle.includes("s") ? hh : 0,
        };
  const v = rotate(local, c.angle_deg);
  return { x: (c.center.x + v.x) / page.width_pt, y: (c.center.y + v.y) / page.height_pt };
}

/** The four corners, normalized, top-left first. */
export function cardCorners(r: OrientedRect, page: PageSize): Point[] {
  return (["nw", "ne", "se", "sw"] as const).map((h) => handlePosition(r, h, page));
}

/** The card's size in points. */
export function cardSizePt(r: OrientedRect, page: PageSize): { width: number; height: number } {
  return { width: r.width * page.width_pt, height: r.height * page.height_pt };
}

/** Keeps `r` valid after a field edit: positive size, angle in range, centre on the page. */
export function sanitizeCard(r: OrientedRect, page: PageSize): OrientedRect {
  const minW = MIN_CARD_PT / page.width_pt;
  const minH = MIN_CARD_PT / page.height_pt;
  return {
    center: { x: clamp(r.center.x, 0, 1), y: clamp(r.center.y, 0, 1) },
    width: Math.max(r.width, minW),
    height: Math.max(r.height, minH),
    angle_deg: normalizeAngle(r.angle_deg),
  };
}
