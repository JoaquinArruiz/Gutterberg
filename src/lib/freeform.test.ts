import { describe, expect, it } from "vitest";
import type { OrientedRect } from "./card";
import {
  cardContains,
  cardCorners,
  drawCard,
  handlePosition,
  isTooSmall,
  MIN_CARD_PT,
  moveCard,
  normalizeAngle,
  resizeCard,
  rotateCardTo,
  sanitizeCard,
  withAngle,
} from "./freeform";

// A 200 x 400 pt page, so a normalized x is worth half a normalized y: any maths that forgets the
// page shape shows up as a skewed angle or size.
const PAGE = { width_pt: 200, height_pt: 400 };
const upright: OrientedRect = { center: { x: 0.5, y: 0.5 }, width: 0.5, height: 0.25, angle_deg: 0 }; // 100 x 100 pt
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("normalizeAngle", () => {
  it("wraps into (-180, 180]", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(540)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(7.5)).toBe(7.5);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});

describe("drawCard", () => {
  it("is upright, in either drag direction, and kept inside the page", () => {
    const a = drawCard({ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.3 }, PAGE);
    const b = drawCard({ x: 0.6, y: 0.3 }, { x: 0.2, y: 0.1 }, PAGE);
    expect(a).toEqual(b);
    expect(a.angle_deg).toBe(0);
    close(a.center.x, 0.4);
    close(a.width, 0.4);
    const out = drawCard({ x: 0.9, y: 0.9 }, { x: 1.5, y: 1.5 }, PAGE);
    close(out.center.x + out.width / 2, 1);
  });

  it("calls a click too small to be a card", () => {
    expect(isTooSmall(drawCard({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5005 }, PAGE), PAGE)).toBe(true);
    expect(isTooSmall(upright, PAGE)).toBe(false);
  });
});

describe("cardContains", () => {
  it("tests inside the rotated rectangle, not its bounding box", () => {
    const tilted = { ...upright, angle_deg: 45 };
    // The corner of the bounding box is outside a 45 degree square; the tip of the square is inside.
    expect(cardContains(tilted, { x: 0.5 + 0.24, y: 0.5 + 0.12 }, PAGE)).toBe(false);
    expect(cardContains(tilted, { x: 0.5, y: 0.5 + 0.12 }, PAGE)).toBe(true);
    expect(cardContains(upright, { x: 0.5, y: 0.5 }, PAGE)).toBe(true);
    expect(cardContains(upright, { x: 0.9, y: 0.5 }, PAGE)).toBe(false);
  });
});

describe("moveCard", () => {
  it("moves the centre and keeps it on the page", () => {
    expect(moveCard(upright, 0.1, -0.2).center).toEqual({ x: 0.6, y: 0.3 });
    expect(moveCard(upright, 5, 5).center).toEqual({ x: 1, y: 1 });
  });
});

describe("resizeCard", () => {
  it("keeps the opposite corner fixed on an upright card", () => {
    const r = resizeCard(upright, "se", 0.1, 0.05, PAGE); // +20 pt, +20 pt
    const [nw] = cardCorners(r, PAGE);
    const [nw0] = cardCorners(upright, PAGE);
    close(nw.x, nw0.x);
    close(nw.y, nw0.y);
    close(r.width * PAGE.width_pt, 120);
    close(r.height * PAGE.height_pt, 120);
  });

  it("measures the drag along the card's own edges when it is tilted", () => {
    const tilted = { ...upright, angle_deg: 90 };
    // Turned a quarter, the card's right edge faces down the page: dragging "e" down grows its width.
    const r = resizeCard(tilted, "e", 0, 0.05, PAGE); // 20 pt down the page
    close(r.width * PAGE.width_pt, 120);
    close(r.height * PAGE.height_pt, 100);
    // The west edge did not move: its midpoint is where it was.
    const w0 = handlePosition(tilted, "w", PAGE);
    const w1 = handlePosition(r, "w", PAGE);
    close(w1.x, w0.x);
    close(w1.y, w0.y);
    expect(r.angle_deg).toBe(90);
  });

  it("never goes below the smallest card", () => {
    const r = resizeCard(upright, "w", 10, 0, PAGE);
    close(r.width * PAGE.width_pt, MIN_CARD_PT);
    const [, ne] = cardCorners(r, PAGE);
    close(ne.x, 0.75); // the east edge stayed
  });
});

describe("rotateCardTo", () => {
  it("points the top edge at the pointer, whatever the page shape", () => {
    // Pointer straight right of the centre: the top edge faces right = 90 degrees clockwise.
    expect(rotateCardTo(upright, { x: 0.9, y: 0.5 }, PAGE, false).angle_deg).toBeCloseTo(90);
    expect(rotateCardTo(upright, { x: 0.5, y: 0.1 }, PAGE, false).angle_deg).toBeCloseTo(0);
    expect(rotateCardTo(upright, { x: 0.1, y: 0.5 }, PAGE, false).angle_deg).toBeCloseTo(-90);
    expect(rotateCardTo(upright, { x: 0.5, y: 0.9 }, PAGE, false).angle_deg).toBeCloseTo(180);
    // 100 pt right and 100 pt up: 45 degrees, although the normalized offsets differ (0.5 and 0.25).
    expect(rotateCardTo(upright, { x: 1, y: 0.25 }, PAGE, false).angle_deg).toBeCloseTo(45);
  });

  it("snaps to 15 degrees with Shift", () => {
    expect(rotateCardTo(upright, { x: 0.6, y: 0 }, PAGE, true).angle_deg).toBe(0); // 5.7 degrees
    expect(rotateCardTo(upright, { x: 0.9, y: 0.4 }, PAGE, true).angle_deg).toBe(60); // about 63
  });

  it("changes nothing but the angle", () => {
    const r = rotateCardTo(upright, { x: 0.9, y: 0.4 }, PAGE, false);
    expect({ ...r, angle_deg: 0 }).toEqual(upright);
  });
});

describe("handlePosition and corners", () => {
  it("places the rotate handle above the top edge, turning with the card", () => {
    const up = handlePosition(upright, "rotate", PAGE, 20);
    close(up.x, 0.5);
    close(up.y, (200 - 50 - 20) / 400);
    const right = handlePosition({ ...upright, angle_deg: 90 }, "rotate", PAGE, 20);
    close(right.x, (100 + 50 + 20) / 200);
    close(right.y, 0.5);
  });

  it("has the corners clockwise from the top-left", () => {
    const [nw, ne, se, sw] = cardCorners(upright, PAGE);
    expect(nw.x).toBeLessThan(ne.x);
    expect(ne.y).toBeLessThan(se.y);
    expect(se.x).toBeGreaterThan(sw.x);
  });
});

describe("field edits", () => {
  it("withAngle wraps, and sanitizeCard repairs a degenerate card", () => {
    expect(withAngle(upright, 370).angle_deg).toBe(10);
    const bad = sanitizeCard({ center: { x: 2, y: -1 }, width: 0, height: -3, angle_deg: 200 }, PAGE);
    expect(bad.center).toEqual({ x: 1, y: 0 });
    expect(bad.width * PAGE.width_pt).toBeCloseTo(MIN_CARD_PT);
    expect(bad.angle_deg).toBe(-160);
  });
});
