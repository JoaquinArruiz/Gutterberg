import { describe, expect, it } from "vitest";
import { cardBox, rectLines, snapOffset, snapTargets, snapTolerance } from "./snap";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const tol = { x: 0.01, y: 0.01 };

describe("snapping", () => {
  it("pulls the nearest edge onto a target within the tolerance, on each axis on its own", () => {
    const moving = rectLines({ x: 0.205, y: 0.62, width: 0.2, height: 0.1 });
    const targets = snapTargets([{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }]);
    const s = snapOffset(moving, targets, tol);
    // The left edge (0.205) meets the other's right edge (0.2); nothing is near on the vertical axis.
    expect(s.dx).toBeCloseTo(-0.005, 9);
    expect(s.dy).toBe(0);
    expect(s.guides.xs).toEqual([0.2]);
    expect(s.guides.ys).toEqual([]);
  });

  it("snaps to the page's edges and middle", () => {
    const moving = rectLines({ x: 0.003, y: 0.396, width: 0.2, height: 0.2 });
    const s = snapOffset(moving, snapTargets([]), tol);
    expect(s.dx).toBeCloseTo(-0.003, 9);
    // The middle (0.496) meets the page's middle.
    expect(s.dy).toBeCloseTo(0.004, 9);
    expect(s.guides).toEqual({ xs: [0], ys: [0.5] });
  });

  it("does nothing when nothing is close enough", () => {
    const moving = rectLines({ x: 0.13, y: 0.13, width: 0.1, height: 0.1 });
    expect(snapOffset(moving, snapTargets([]), tol)).toEqual({ dx: 0, dy: 0, guides: { xs: [], ys: [] } });
  });

  it("takes the closest of several targets and shows every line that lines up", () => {
    // Same width as the other piece: once the left edges meet, the right edges and middles meet too.
    const other = { x: 0.3, y: 0.6, width: 0.2, height: 0.1 };
    const moving = rectLines({ x: 0.304, y: 0.2, width: 0.2, height: 0.1 });
    const s = snapOffset(moving, snapTargets([other]), tol);
    expect(s.dx).toBeCloseTo(-0.004, 9);
    expect(s.guides.xs).toEqual([0.3, 0.4, 0.5]);
  });

  it("measures the tolerance in screen pixels, per axis", () => {
    const t = snapTolerance(A4, 1, 6);
    expect(t.x).toBeCloseTo(6 / A4.width_pt, 9);
    expect(t.y).toBeCloseTo(6 / A4.height_pt, 9);
    expect(snapTolerance(A4, 2, 6).x).toBeCloseTo(t.x / 2, 9);
  });

  it("snaps a turned piece by the upright box it fits in", () => {
    const upright = cardBox({ center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.1, angle_deg: 0 }, A4);
    expect(upright.x).toBeCloseTo(0.4, 9);
    expect(upright.width).toBeCloseTo(0.2, 9);
    const turned = cardBox({ center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.1, angle_deg: 90 }, A4);
    // A quarter turn swaps the sides in points, so the box is as wide as the piece was tall, in points.
    expect(turned.width * A4.width_pt).toBeCloseTo(0.1 * A4.height_pt, 6);
    expect(turned.height * A4.height_pt).toBeCloseTo(0.2 * A4.width_pt, 6);
  });
});
