import { describe, expect, it } from "vitest";
import { BUILT_IN_SIZES, builtInSize, normalizeSizePresets, presetScales, stretches } from "./size-presets";
import { mmToPt } from "./units";

const source = (w: number, h: number) => ({ width: mmToPt(w), height: mmToPt(h) });

describe("built-in sizes", () => {
  it("has the sleeve sizes people ask for, each once", () => {
    expect(BUILT_IN_SIZES.map((s) => s.id)).toEqual([
      "poker",
      "standard",
      "miniAmerican",
      "miniEuropean",
      "european",
      "japanese",
      "square",
      "tarot",
    ]);
    expect(builtInSize("poker")).toMatchObject({ widthMm: 63.5, heightMm: 88.9 });
    expect(builtInSize("japanese")).toMatchObject({ widthMm: 59, heightMm: 86 });
  });
});

describe("presetScales", () => {
  it("sets each side for a size with both, so a piece of other proportions is stretched", () => {
    const { x, y } = presetScales(source(60, 80), { widthMm: 63, heightMm: 88 });
    expect(x).toBeCloseTo(1.05);
    expect(y).toBeCloseTo(1.1);
  });

  it("keeps the proportions for a size that fixes one side", () => {
    expect(presetScales(source(60, 80), { widthMm: 62, heightMm: null })).toEqual({
      x: expect.closeTo(62 / 60, 6),
      y: expect.closeTo(62 / 60, 6),
    });
    const h = presetScales(source(60, 80), { widthMm: null, heightMm: 88 });
    expect(h.x).toBeCloseTo(1.1);
    expect(h.y).toBeCloseTo(1.1);
  });
});

describe("stretches", () => {
  it("is only true for two sides and proportions that differ by more than a percent", () => {
    expect(stretches(source(63, 88), { widthMm: 63, heightMm: 88 })).toBe(false);
    expect(stretches(source(63.3, 88), { widthMm: 63, heightMm: 88 })).toBe(false);
    expect(stretches(source(88, 63), { widthMm: 63, heightMm: 88 })).toBe(true);
    expect(stretches(source(88, 63), { widthMm: 62, heightMm: null })).toBe(false);
  });
});

describe("normalizeSizePresets", () => {
  it("keeps named sizes with a side, unique by name without case, clamped, and drops the rest", () => {
    const out = normalizeSizePresets([
      { name: "  My sleeves ", widthMm: 62, heightMm: null },
      { name: "my sleeves", widthMm: 70, heightMm: 70 },
      { name: "Tall", widthMm: null, heightMm: 9999 },
      { name: "Nothing", widthMm: null, heightMm: null },
      { name: "", widthMm: 60, heightMm: 60 },
      { widthMm: 60, heightMm: 60 },
      "x",
    ]);
    expect(out).toEqual([
      { name: "My sleeves", widthMm: 62, heightMm: null },
      { name: "Tall", widthMm: null, heightMm: 1000 },
    ]);
    expect(normalizeSizePresets("nope")).toEqual([]);
  });
});
