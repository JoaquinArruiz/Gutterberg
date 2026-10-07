import { describe, expect, it } from "vitest";
import { BASE_MAX_PX, covers, MAX_CROP_PX, needsDetail, planCrop, scaleIsOk, visibleNormalized } from "./view-region";

const box = { width: 1280, height: 800 };
const A4 = { w: 793.7, h: 1122.5 }; // CSS px at 100%

/** Page rect for a zoom (100% = 96dpi) and the page's top-left on screen. */
const page = (zoom: number, x: number, y: number) => ({ x, y, width: A4.w * zoom, height: A4.h * zoom });

/** Mirror of what render_region_png does with the region it is sent. */
function backendPixels(send: { x: number; y: number; width: number; height: number }, fw: number, fh: number) {
  const x0 = Math.floor(send.x * fw),
    y0 = Math.floor(send.y * fh);
  const x1 = Math.ceil((send.x + send.width) * fw),
    y1 = Math.ceil((send.y + send.height) * fh);
  return { x0, y0, x1, y1 };
}

describe("view-region", () => {
  it("only needs detail beyond the base width", () => {
    expect(needsDetail(page(1, 0, 0), 2)).toBe(false); // 1587 px
    expect(needsDetail(page(2, 0, 0), 2)).toBe(true); // 3174 px
    expect(BASE_MAX_PX).toBe(2048);
  });

  it("covers the visible area and never exceeds the backend crop limit", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      for (const zoom of [3, 8, 16]) {
        for (const [x, y] of [
          [-3000, -4000],
          [-200, 100],
          [0, 0],
          [-9000, -15000],
        ]) {
          const p = page(zoom, x, y);
          const crop = planCrop(p, box, dpr);
          if (!crop) continue;
          const fh = (crop.fullWidthPx * p.height) / p.width;
          const px = backendPixels(crop.send, crop.fullWidthPx, fh);
          expect(px.x1 - px.x0).toBeLessThanOrEqual(MAX_CROP_PX);
          expect(px.y1 - px.y0).toBeLessThanOrEqual(MAX_CROP_PX);
          // the backend's floor/ceil land exactly on the region we use to place the image
          expect(px.x0 / crop.fullWidthPx).toBeCloseTo(crop.region.x, 12);
          expect(px.x1 / crop.fullWidthPx).toBeCloseTo(crop.region.x + crop.region.width, 12);
          expect(px.y0 / fh).toBeCloseTo(crop.region.y, 12);
          expect(px.y1 / fh).toBeCloseTo(crop.region.y + crop.region.height, 12);
          expect(crop.region.x).toBeGreaterThanOrEqual(0);
          expect(crop.region.x + crop.region.width).toBeLessThanOrEqual(1 + 1e-12);
          // when the padded viewport fits the cap, it is fully covered
          const dev = box.width * dpr * 1.4;
          if (dev < MAX_CROP_PX) expect(covers(crop.region, p, box)).toBe(true);
        }
      }
    }
  });

  it("keeps a crop small regardless of zoom (the point of the fix)", () => {
    const crop = planCrop(page(16, -5000, -7000), box, 2);
    if (!crop) throw new Error("expected a crop");
    const px = crop.region.width * crop.fullWidthPx * (crop.region.height * crop.fullWidthPx * (A4.h / A4.w));
    expect(px).toBeLessThan(12e6); // vs 8192 x 11585 = 95 MP for a full page
  });

  it("reports when panning has left the rendered crop", () => {
    const p = page(8, -2000, -3000);
    const crop = planCrop(p, box, 1);
    if (!crop) throw new Error("expected a crop");
    expect(covers(crop.region, p, box)).toBe(true);
    expect(covers(crop.region, { ...p, x: p.x - 100 }, box)).toBe(true); // small pan: still covered (padding)
    expect(covers(crop.region, { ...p, x: p.x - 1500 }, box)).toBe(false); // big pan: needs a new render
  });

  it("returns nothing when the page is off screen", () => {
    expect(visibleNormalized(page(8, -99999, 0), box)).toBeNull();
    expect(planCrop(page(8, -99999, 0), box, 1)).toBeNull();
  });

  it("tolerates a quarter-octave of zoom change before re-rendering", () => {
    expect(scaleIsOk(4000, 4000)).toBe(true);
    expect(scaleIsOk(4000, 4700)).toBe(true);
    expect(scaleIsOk(4000, 4900)).toBe(false);
    expect(scaleIsOk(4000, 1900)).toBe(false);
  });
});
