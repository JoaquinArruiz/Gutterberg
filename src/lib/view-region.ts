// Geometry for the main view's "detail" layer: when zoomed in, only the part of
// the page that is on screen (plus some padding) is rasterised, instead of the
// whole page. A full page at high zoom is hundreds of MB and blocks the
// (serialised) pdfium backend for seconds; a crop of the viewport is ~1-9 MP.

import type { NormalizedRect, Rect, Size } from "./coordinates";

/** The full-page base layer is never rendered wider than this (~24 MB). */
export const BASE_MAX_PX = 2048;
/** The backend clamps a crop to this many px per side (render_region_png). */
export const MAX_CROP_PX = 4096;
/** The backend clamps the page scale to this width (render_region_png). */
export const MAX_FULL_WIDTH_PX = 32768;
/** Extra margin around the viewport, as a fraction of it, so small pans don't need a new render. */
export const PAD_FRACTION = 0.2;

export type Crop = {
  /** What to ask the backend for. Inset by half a pixel so its floor/ceil land exactly on `region`. */
  send: NormalizedRect;
  /** What the returned bitmap actually covers: exact device-pixel boundaries. Use this to place the image. */
  region: NormalizedRect;
  /** Page scale (device px across the whole page) the crop is rendered at. */
  fullWidthPx: number;
};

/** True once the page is displayed wider than the base layer can supply. */
export const needsDetail = (pageRect: Rect, dpr: number) => pageRect.width * dpr > BASE_MAX_PX;

/** The on-screen part of the page as a normalized rect, or null when the page is off screen. */
export function visibleNormalized(pageRect: Rect, box: Size): NormalizedRect | null {
  const x0 = Math.max(pageRect.x, 0);
  const y0 = Math.max(pageRect.y, 0);
  const x1 = Math.min(pageRect.x + pageRect.width, box.width);
  const y1 = Math.min(pageRect.y + pageRect.height, box.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    x: (x0 - pageRect.x) / pageRect.width,
    y: (y0 - pageRect.y) / pageRect.height,
    width: (x1 - x0) / pageRect.width,
    height: (y1 - y0) / pageRect.height,
  };
}

/** One axis: padded visible range in px at the render scale, snapped to whole pixels and capped at MAX_CROP_PX. */
function axis(visStart: number, visEnd: number, fullPx: number, pad: number): [number, number] {
  const want = Math.min(MAX_CROP_PX, visEnd - visStart + 2 * pad * (visEnd - visStart));
  const centre = (visStart + visEnd) / 2;
  const p0 = Math.floor(Math.max(0, centre - want / 2));
  let p1 = Math.ceil(Math.min(fullPx, centre + want / 2));
  if (p1 - p0 > MAX_CROP_PX) p1 = p0 + MAX_CROP_PX;
  return [p0, p1];
}

/** Plan the crop to render for the current view, or null when there is nothing to draw. */
export function planCrop(pageRect: Rect, box: Size, dpr: number): Crop | null {
  const vis = visibleNormalized(pageRect, box);
  if (!vis) return null;
  const fullW = Math.min(MAX_FULL_WIDTH_PX, Math.max(16, Math.round(pageRect.width * dpr)));
  const fullH = (fullW * pageRect.height) / pageRect.width;
  const [px0, px1] = axis(vis.x * fullW, (vis.x + vis.width) * fullW, fullW, PAD_FRACTION);
  const [py0, py1] = axis(vis.y * fullH, (vis.y + vis.height) * fullH, fullH, PAD_FRACTION);
  if (px1 - px0 < 2 || py1 - py0 < 2) return null;
  return {
    fullWidthPx: fullW,
    region: { x: px0 / fullW, y: py0 / fullH, width: (px1 - px0) / fullW, height: (py1 - py0) / fullH },
    send: {
      x: (px0 + 0.5) / fullW,
      y: (py0 + 0.5) / fullH,
      width: (px1 - px0 - 1) / fullW,
      height: (py1 - py0 - 1) / fullH,
    },
  };
}

/** Does a rendered crop still cover everything currently on screen? */
export function covers(region: NormalizedRect, pageRect: Rect, box: Size): boolean {
  const v = visibleNormalized(pageRect, box);
  if (!v) return true; // nothing visible, nothing to cover
  const eps = 1e-9;
  return (
    region.x <= v.x + eps &&
    region.y <= v.y + eps &&
    region.x + region.width >= v.x + v.width - eps &&
    region.y + region.height >= v.y + v.height - eps
  );
}

/**
 * Is an image rendered at `renderedWidth` still good for a view that wants
 * `neededWidth`? Up to ~19% of upscaling is tolerated (a quarter-octave), so a
 * zoom gesture doesn't re-render on every step. Much smaller is wasteful.
 */
/**
 * Rounds a page-scale width up to a quarter-octave step, so small zoom changes
 * ask for the same scale and the request is not repeated.
 */
export const quantizeWidth = (w: number) => (w > 0 ? 2 ** (Math.ceil(Math.log2(w) * 4) / 4) : 0);

export const scaleIsOk = (renderedWidth: number, neededWidth: number) =>
  neededWidth <= renderedWidth * 2 ** 0.25 && neededWidth >= renderedWidth * 0.5;
