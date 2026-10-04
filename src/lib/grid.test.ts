import { describe, expect, it } from "vitest";
import { cardRects, cardSizeMm, selectionAtMm, selectionForCardSize } from "./grid";
import { mmToPt } from "./units";

const A4 = { width_pt: mmToPt(210), height_pt: mmToPt(297) };
const grid = { rows: 3, columns: 3 };
const close = (a: number, b: number, d = 9) => expect(a).toBeCloseTo(b, d);

// 3x3 of 63.5 x 88 mm cards centred on A4
const sel = { x: 9.75 / 210, y: 16.5 / 297, width: 190.5 / 210, height: 264 / 297 };

describe("grid", () => {
  it("computes card size in mm", () => {
    const s = cardSizeMm(sel, A4, grid);
    close(s.width, 63.5);
    close(s.height, 88);
  });

  it("builds row-major card rects that tile the selection", () => {
    const r = cardRects(sel, grid, A4);
    expect(r).toHaveLength(9);
    close(r[1].x, r[0].x + r[0].width);
    close(r[3].y, r[0].y + r[0].height);
    close(r[8].x + r[8].width, sel.x + sel.width);
    close(r[8].y + r[8].height, sel.y + sel.height);
  });

  it("sets an exact card size by resizing the selection from its top-left", () => {
    const rough = { x: 0.05, y: 0.0535, width: 0.901, height: 0.8906 };
    const fixed = selectionForCardSize(rough, A4, grid, { width: 63.5, height: 88 });
    const s = cardSizeMm(fixed, A4, grid);
    close(s.width, 63.5);
    close(s.height, 88);
    expect([fixed.x, fixed.y]).toEqual([0.05, 0.0535]);
  });

  it("clamps card size so the selection stays on the page", () => {
    const f = selectionForCardSize({ ...sel, x: 0.5 }, A4, grid, { width: 500 });
    close(f.x + f.width, 1);
  });

  it("positions the selection in mm and clamps to the page", () => {
    const m = selectionAtMm(sel, A4, { x: 10, y: 20 });
    close(m.x * 210, 10);
    close(m.y * 297, 20);
    expect(selectionAtMm(sel, A4, { x: 999 }).x).toBeCloseTo(1 - sel.width, 9);
  });

  it("accounts for source gaps when deriving card size and rects", () => {
    // 3 cards of 60 mm with 2 mm gaps = 184 mm wide
    const g = { rows: 1, columns: 3, gapXMm: 2, gapYMm: 0 };
    const s = { x: 0.1, y: 0.1, width: 184 / 210, height: 100 / 297 };
    close(cardSizeMm(s, A4, g).width, 60);
    const r = cardRects(s, g, A4);
    close((r[1].x - (r[0].x + r[0].width)) * 210, 2);
    close((r[2].x + r[2].width) - (s.x + s.width), 0);
    const f = selectionForCardSize(s, A4, g, { width: 60 });
    close(f.width * 210, 184);
  });
});
