import { describe, expect, it } from "vitest";
import {
  documentToScreen, fitViewport, normalizedToPdf, pageScreenRect, pdfToNormalized,
  rectToScreen, screenToDocument, zoomAt, type ViewportState,
} from "./coordinates";
import { moveRect, resizeRect, rectFromPoints } from "./selection";
import { mmToPt, ptToMm } from "./units";

const A4 = { width_pt: mmToPt(210), height_pt: mmToPt(297) };
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("coordinates", () => {
  it("screen <-> document round-trips at any zoom/pan", () => {
    for (const vp of [
      { zoom: 0.5, panX: 10, panY: 20 },
      { zoom: 1, panX: -300, panY: 5 },
      { zoom: 8, panX: -4000, panY: -9000 },
    ] as ViewportState[]) {
      const p = { x: 0.31, y: 0.77 };
      const back = screenToDocument(documentToScreen(p, vp, A4), vp, A4);
      near(back.x, p.x);
      near(back.y, p.y);
    }
  });

  it("a selection stays on the same document point across zoom levels", () => {
    const n = { x: 0.14, y: 0.08, width: 0.72, height: 0.84 };
    const vp = { zoom: 1, panX: 40, panY: 30 };
    const anchor = { x: 300, y: 200 };
    const before = screenToDocument(anchor, vp, A4);
    for (const z of [0.5, 2, 4]) {
      const next = zoomAt(vp, z, anchor, A4);
      const after = screenToDocument(anchor, next, A4);
      near(after.x, before.x);
      near(after.y, before.y);
      // rect edges scale exactly with the page rect
      const page = pageScreenRect(next, A4);
      const r = rectToScreen(n, next, A4);
      near((r.x - page.x) / page.width, n.x);
      near(r.width / page.width, n.width);
    }
  });

  it("100% zoom is 96 CSS px per inch", () => {
    near(pageScreenRect({ zoom: 1, panX: 0, panY: 0 }, A4).width, (210 / 25.4) * 96);
  });

  it("normalized <-> PDF flips the y axis", () => {
    const pdf = normalizedToPdf({ x: 0.1, y: 0, width: 0.5, height: 0.25 }, A4);
    near(pdf.y, A4.height_pt * 0.75); // top strip -> high y in PDF space
    const n = pdfToNormalized(pdf, A4);
    near(n.y, 0);
    near(n.height, 0.25);
    near(ptToMm(pdf.width), 105);
  });

  it("fit centres the page inside the box", () => {
    const vp = fitViewport({ width: 800, height: 600 }, A4, 20);
    const r = pageScreenRect(vp, A4);
    expect(r.height).toBeLessThanOrEqual(560 + 1e-6);
    near(r.x + r.width / 2, 400);
    near(r.y + r.height / 2, 300);
  });
});

describe("selection", () => {
  it("rectFromPoints clamps to the page", () => {
    expect(rectFromPoints({ x: 0.5, y: 0.5 }, { x: 1.4, y: -0.2 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });
  it("moveRect keeps the rect inside the page", () => {
    const r = moveRect({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, 0.5, -0.9);
    expect(r).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });
  it("resizeRect keeps the opposite edge fixed and enforces a minimum", () => {
    const r0 = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
    const a = resizeRect(r0, "se", 0.1, 0.1);
    expect([a.x, a.y]).toEqual([0.2, 0.2]);
    near(a.width, 0.5);
    const b = resizeRect(r0, "w", 5, 0); // dragged past the right edge
    near(b.x + b.width, 0.6);
    near(b.width, 0.01);
    const c = resizeRect(r0, "n", 0, -5); // clamps at page top
    near(c.y, 0);
  });
});
