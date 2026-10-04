import { describe, expect, it } from "vitest";
import { handlePoint, resizeRect } from "./selection";

const sel = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };

describe("handlePoint", () => {
  it("returns corners and edge midpoints", () => {
    const close = (a: { x: number; y: number }, x: number, y: number) => {
      expect(a.x).toBeCloseTo(x);
      expect(a.y).toBeCloseTo(y);
    };
    close(handlePoint(sel, "nw"), 0.2, 0.3);
    close(handlePoint(sel, "se"), 0.6, 0.5);
    close(handlePoint(sel, "n"), 0.4, 0.3);
    close(handlePoint(sel, "e"), 0.6, 0.4);
  });

  it("tracks the handle as the selection is resized", () => {
    const r = resizeRect(sel, "e", 0.1, 0);
    expect(handlePoint(r, "e").x).toBeCloseTo(0.7);
  });
});
