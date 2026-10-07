// The ONLY place that converts between coordinate spaces. Components must not
// do this maths inline.
//
//   normalized  0..1 relative to the page, origin top-left   (stored geometry)
//   screen      CSS pixels relative to the viewport element  (never stored)
//   pdf         points, origin BOTTOM-left                   (PDF user space)
//
// Millimetres <-> points live in lib/units.ts.

import type { OrientedRect } from "./card";
import type { PageSize } from "./tauri";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type Rect = NormalizedRect; // same shape; the space is given by context

/** Pan/zoom only; independent of document geometry. */
export type ViewportState = {
  zoom: number; // 1 = 100% = 96 CSS px per inch
  panX: number; // screen position of the page's top-left corner
  panY: number;
};

export const CSS_PX_PER_PT = 96 / 72;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Screen pixels per PDF point at the given zoom. */
export const pxPerPoint = (zoom: number) => zoom * CSS_PX_PER_PT;

/** Where the page sits on screen. */
export function pageScreenRect(vp: ViewportState, page: PageSize): Rect {
  const k = pxPerPoint(vp.zoom);
  return { x: vp.panX, y: vp.panY, width: page.width_pt * k, height: page.height_pt * k };
}

export function screenToDocument(p: Point, vp: ViewportState, page: PageSize): Point {
  const r = pageScreenRect(vp, page);
  return { x: (p.x - r.x) / r.width, y: (p.y - r.y) / r.height };
}

export function documentToScreen(p: Point, vp: ViewportState, page: PageSize): Point {
  const r = pageScreenRect(vp, page);
  return { x: r.x + p.x * r.width, y: r.y + p.y * r.height };
}

export function rectToScreen(n: NormalizedRect, vp: ViewportState, page: PageSize): Rect {
  const r = pageScreenRect(vp, page);
  return { x: r.x + n.x * r.width, y: r.y + n.y * r.height, width: n.width * r.width, height: n.height * r.height };
}

/** Normalized (top-left origin) -> PDF points (bottom-left origin). */
export function normalizedToPdf(n: NormalizedRect, page: PageSize): Rect {
  const width = n.width * page.width_pt;
  const height = n.height * page.height_pt;
  return { x: n.x * page.width_pt, y: page.height_pt - n.y * page.height_pt - height, width, height };
}

export function pdfToNormalized(r: Rect, page: PageSize): NormalizedRect {
  return {
    x: r.x / page.width_pt,
    y: (page.height_pt - r.y - r.height) / page.height_pt,
    width: r.width / page.width_pt,
    height: r.height / page.height_pt,
  };
}

/** Change zoom while keeping the document point under `anchor` (screen px) fixed. */
export function zoomAt(vp: ViewportState, zoom: number, anchor: Point, page: PageSize): ViewportState {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const doc = screenToDocument(anchor, vp, page);
  const k = pxPerPoint(z);
  return { zoom: z, panX: anchor.x - doc.x * page.width_pt * k, panY: anchor.y - doc.y * page.height_pt * k };
}

/** Zoom/pan that fits the whole page inside `box`, centred. */
export function fitViewport(box: Size, page: PageSize, padding = 24): ViewportState {
  const zoom = clamp(
    Math.min(
      (box.width - padding * 2) / (page.width_pt * CSS_PX_PER_PT),
      (box.height - padding * 2) / (page.height_pt * CSS_PX_PER_PT),
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const k = pxPerPoint(zoom);
  return { zoom, panX: (box.width - page.width_pt * k) / 2, panY: (box.height - page.height_pt * k) / 2 };
}

/** An oriented rect held normalized to the page -> points (top-left origin). The angle is unchanged: it is applied in point space. */
export function orientedToPoints(r: OrientedRect, page: PageSize): OrientedRect {
  return {
    center: { x: r.center.x * page.width_pt, y: r.center.y * page.height_pt },
    width: r.width * page.width_pt,
    height: r.height * page.height_pt,
    angle_deg: r.angle_deg,
  };
}

/** An oriented rect held normalized -> screen px: centre, size and angle, ready to draw rotated about its centre. */
export function orientedToScreen(r: OrientedRect, vp: ViewportState, page: PageSize): OrientedRect {
  const p = pageScreenRect(vp, page);
  return {
    center: { x: p.x + r.center.x * p.width, y: p.y + r.center.y * p.height },
    width: r.width * p.width,
    height: r.height * p.height,
    angle_deg: r.angle_deg,
  };
}

export function orientedFromPoints(r: OrientedRect, page: PageSize): OrientedRect {
  return {
    center: { x: r.center.x / page.width_pt, y: r.center.y / page.height_pt },
    width: r.width / page.width_pt,
    height: r.height / page.height_pt,
    angle_deg: r.angle_deg,
  };
}
