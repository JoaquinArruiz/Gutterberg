import { describe, expect, it } from "vitest";
import { addGuide, dropGuide, guideFrom, moveGuide, NO_GUIDE_SET, overRuler, removeGuide, rulerOf } from "./guides";

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

  it("are over the top ruler above the canvas, and over the left one left of it", () => {
    expect(overRuler("top", { x: 300, y: -1 })).toBe(true);
    expect(overRuler("top", { x: -10, y: 5 })).toBe(false);
    expect(overRuler("left", { x: -1, y: 300 })).toBe(true);
    expect(overRuler("left", { x: 0, y: -5 })).toBe(false);
  });

  it("come from the ruler parallel to them, or the perpendicular one with the rulers inverted", () => {
    expect([guideFrom("top", false), guideFrom("left", false)]).toEqual(["y", "x"]);
    expect([guideFrom("top", true), guideFrom("left", true)]).toEqual(["x", "y"]);
    for (const inverted of [false, true])
      for (const ruler of ["top", "left"] as const) expect(rulerOf(guideFrom(ruler, inverted), inverted)).toBe(ruler);
  });
});
