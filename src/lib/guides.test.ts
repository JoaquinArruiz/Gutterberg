import { describe, expect, it } from "vitest";
import { addGuide, dropGuide, moveGuide, NO_GUIDE_SET, overRuler, removeGuide } from "./guides";

describe("guides", () => {
  it("are made, moved and deleted on their own axis", () => {
    let g = addGuide(NO_GUIDE_SET, "y", 100);
    g = addGuide(g, "x", 50);
    g = addGuide(g, "y", 200);
    expect(g).toEqual({ xs: [50], ys: [100, 200] });
    expect(moveGuide(g, "y", 1, 250)).toEqual({ xs: [50], ys: [100, 250] });
    expect(removeGuide(g, "y", 0)).toEqual({ xs: [50], ys: [200] });
    expect(NO_GUIDE_SET).toEqual({ xs: [], ys: [] });
  });

  it("are deleted when dropped back on their ruler, and a new one dropped there is not made", () => {
    const g = { xs: [50], ys: [100] };
    expect(dropGuide(g, "y", null, 300, false)).toEqual({ xs: [50], ys: [100, 300] });
    expect(dropGuide(g, "y", null, -5, true)).toBe(g);
    expect(dropGuide(g, "x", 0, 80, false)).toEqual({ xs: [80], ys: [100] });
    expect(dropGuide(g, "x", 0, -2, true)).toEqual({ xs: [], ys: [100] });
  });

  it("are over their ruler above the canvas (horizontal) or left of it (vertical)", () => {
    expect(overRuler("y", { x: 300, y: -1 })).toBe(true);
    expect(overRuler("y", { x: -10, y: 5 })).toBe(false);
    expect(overRuler("x", { x: -1, y: 300 })).toBe(true);
    expect(overRuler("x", { x: 0, y: -5 })).toBe(false);
  });
});
