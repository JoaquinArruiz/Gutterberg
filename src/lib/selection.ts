import { clamp, type NormalizedRect, type Point } from "./coordinates";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Smallest selection edge, as a fraction of the page. */
export const MIN_SIZE = 0.01;

/** Rect spanned by two points, clamped to the page. */
export function rectFromPoints(a: Point, b: Point): NormalizedRect {
  const x0 = clamp(Math.min(a.x, b.x), 0, 1);
  const y0 = clamp(Math.min(a.y, b.y), 0, 1);
  const x1 = clamp(Math.max(a.x, b.x), 0, 1);
  const y1 = clamp(Math.max(a.y, b.y), 0, 1);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Translate by (dx, dy) normalized, keeping the rect inside the page. */
export function moveRect(r: NormalizedRect, dx: number, dy: number): NormalizedRect {
  return {
    ...r,
    x: clamp(r.x + dx, 0, 1 - r.width),
    y: clamp(r.y + dy, 0, 1 - r.height),
  };
}

/** Drag `handle` by (dx, dy) normalized. Opposite edges stay put; min size enforced. */
export function resizeRect(r: NormalizedRect, handle: Handle, dx: number, dy: number): NormalizedRect {
  let left = r.x,
    top = r.y,
    right = r.x + r.width,
    bottom = r.y + r.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_SIZE);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The point of `sel` a handle controls: a corner, or the midpoint of an edge. */
export function handlePoint(sel: NormalizedRect, h: Handle): Point {
  return {
    x: h.includes("w") ? sel.x : h.includes("e") ? sel.x + sel.width : sel.x + sel.width / 2,
    y: h.includes("n") ? sel.y : h.includes("s") ? sel.y + sel.height : sel.y + sel.height / 2,
  };
}
