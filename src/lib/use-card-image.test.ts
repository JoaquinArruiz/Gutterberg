import { describe, expect, it } from "vitest";
import { cropPixels, sharedPageWidth } from "./use-card-image";

const letter = { width_pt: 612, height_pt: 792 };

describe("sharedPageWidth", () => {
  it("rounds the page width up so pieces of nearly the same size share one drawing", () => {
    expect(sharedPageWidth(700, letter)).toBe(768);
    expect(sharedPageWidth(760, letter)).toBe(768);
  });

  it("gives up on a page too large to keep, so the crop is rendered on its own", () => {
    expect(sharedPageWidth(1700, letter)).toBeNull(); // 1792 wide is 2319 tall
    expect(sharedPageWidth(9000, letter)).toBeNull();
  });
});

describe("cropPixels", () => {
  it("covers the whole region, rounding outwards", () => {
    expect(cropPixels({ x: 0.1, y: 0.25, width: 0.5, height: 0.5 }, 100, 200)).toEqual({
      x: 10,
      y: 50,
      width: 50,
      height: 100,
    });
    expect(cropPixels({ x: 0.105, y: 0, width: 0.1, height: 1 }, 100, 10)).toEqual({
      x: 10,
      y: 0,
      width: 11,
      height: 10,
    });
  });

  it("stays inside the picture", () => {
    expect(cropPixels({ x: -0.1, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)).toEqual({
      x: 0,
      y: 90,
      width: 40,
      height: 10,
    });
  });
});
