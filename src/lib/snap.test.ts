import { describe, expect, it } from "vitest";
import {
  cardBox,
  type EdgeLines,
  edgeTargets,
  FREE,
  joinLines,
  rectLines,
  type Stick,
  snapOffset,
  snapTargets,
  snapTolerance,
  stickyOffset,
} from "./snap";

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

describe("edges in the artwork as targets", () => {
  const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  const edges: EdgeLines = {
    xs: [
      { at: 0.21, from: 0.1, to: 0.7 }, // along the whole left side
      { at: 0.59, from: 0.2, to: 0.4 }, // half the right side, exactly
      { at: 0.3, from: 0.3, to: 0.35 }, // art inside: an eighth of the side
      { at: 0.61, from: 0.7, to: 0.9 }, // below the box: no overlap
    ],
    ys: [{ at: 0.6, from: 0.1, to: 0.35 }],
  };

  it("counts an edge only where it runs along at least half of the side it would pull", () => {
    expect(edgeTargets(box, edges)).toEqual({ xs: [0.21, 0.59], ys: [] });
    expect(edgeTargets({ ...box, x: 0.0, width: 0.6 }, edges).ys).toEqual([]);
    expect(edgeTargets({ ...box, x: 0.1, width: 0.4 }, edges).ys).toEqual([0.6]);
  });

  it("joins with the other targets", () => {
    expect(joinLines({ xs: [0], ys: [1] }, { xs: [0.5], ys: [] })).toEqual({ xs: [0, 0.5], ys: [1] });
  });
});

describe("sticky snapping", () => {
  const tol = { x: 0.01, y: 0.01 };
  const release = { x: 0.02, y: 0.02 };
  const targets = { xs: [0.3], ys: [] };
  /** A 0.1 wide box whose left side is `x`, dragged by its left side (the pointer is on it). */
  const step = (x: number, state: Stick) =>
    stickyOffset({ xs: [x, x + 0.1], ys: [] }, targets, tol, release, { x, y: 0.5 }, state);

  it("holds a line on its target until the pointer has moved the release distance on, then lets go", () => {
    let s = step(0.292, FREE); // within the tolerance: snaps
    expect(s.dx).toBeCloseTo(0.008, 9);
    expect(s.guides.xs).toEqual([0.3]);
    s = step(0.31, s.state); // further than the tolerance, but not the release distance: still held
    expect(s.dx).toBeCloseTo(-0.01, 9);
    s = step(0.311, s.state);
    expect(s.dx).toBeCloseTo(-0.011, 9);
    s = step(0.313, s.state); // 0.021 from where it snapped: lets go
    expect(s.dx).toBe(0);
    expect(s.guides.xs).toEqual([]);
  });

  it("does not snap straight back to the target it let go of, until the lines are clear of it", () => {
    // A release distance under twice the tolerance (as on screen: 10 px and 6 px) lets go within the tolerance.
    const short = { x: 0.015, y: 0.015 };
    const at = (x: number, state: Stick) =>
      stickyOffset({ xs: [x], ys: [] }, targets, tol, short, { x, y: 0.5 }, state);
    let s = at(0.309, FREE);
    expect(s.dx).toBeCloseTo(-0.009, 9);
    s = at(0.293, s.state); // let go, still within the tolerance: free
    expect(s.dx).toBe(0);
    s = at(0.305, s.state); // the target it just let go of: still free
    expect(s.dx).toBe(0);
    s = at(0.33, s.state); // clear of it
    s = at(0.305, s.state); // a new approach snaps again
    expect(s.dx).toBeCloseTo(-0.005, 9);
  });

  it("lets go when the target is gone (an edge no longer along the side)", () => {
    let s = step(0.295, FREE);
    s = stickyOffset({ xs: [0.296, 0.396], ys: [] }, { xs: [], ys: [] }, tol, release, { x: 0.296, y: 0.5 }, s.state);
    expect(s.dx).toBe(0);
  });

  it("keeps the two axes apart", () => {
    const s = stickyOffset(
      { xs: [0.295], ys: [0.7] },
      { xs: [0.3], ys: [0.5] },
      tol,
      release,
      { x: 0.295, y: 0.7 },
      FREE,
    );
    expect(s.dx).toBeCloseTo(0.005, 9);
    expect(s.dy).toBe(0);
    expect(s.state.y.held).toBeNull();
  });
});
