import { describe, expect, it } from "vitest";
import { MIN_LABEL_PX, MIN_TICK_PX, rulerSteps, rulerTicks } from "./rulers";
import { MM_PER_INCH } from "./units";

describe("rulerSteps", () => {
  it("takes the smallest step whose ticks stay readable, in millimetres", () => {
    expect(rulerSteps("mm", 8)).toEqual({ tickMm: 1, labelMm: 10 });
    expect(rulerSteps("mm", 3)).toEqual({ tickMm: 5, labelMm: 50 });
    expect(rulerSteps("mm", 1)).toEqual({ tickMm: 10, labelMm: 50 });
    expect(rulerSteps("mm", 0.3)).toEqual({ tickMm: 50, labelMm: 500 });
    // Very far out: the largest step, even if dense.
    expect(rulerSteps("mm", 0.01).tickMm).toBe(50);
  });

  it("uses fractions of an inch in inches", () => {
    const pxPerIn = (px: number) => px / MM_PER_INCH;
    expect(rulerSteps("in", pxPerIn(200)).tickMm).toBeCloseTo(MM_PER_INCH / 16, 9);
    expect(rulerSteps("in", pxPerIn(60)).tickMm).toBeCloseTo(MM_PER_INCH / 8, 9);
    expect(rulerSteps("in", pxPerIn(30)).tickMm).toBeCloseTo(MM_PER_INCH / 4, 9);
    expect(rulerSteps("in", pxPerIn(10)).tickMm).toBeCloseTo(MM_PER_INCH, 9);
    expect(rulerSteps("in", pxPerIn(200)).labelMm).toBeCloseTo(MM_PER_INCH, 9);
  });

  it("keeps ticks and numbers apart by at least their minimum at any zoom it can", () => {
    for (const unit of ["mm", "cm", "in"] as const)
      for (let k = 0.2; k < 60; k *= 1.3) {
        const { tickMm, labelMm } = rulerSteps(unit, k);
        if (tickMm * k < MIN_TICK_PX) continue; // the largest step, far out
        expect(tickMm * k).toBeGreaterThanOrEqual(MIN_TICK_PX);
        if (labelMm * k >= MIN_LABEL_PX)
          expect(Math.abs(labelMm / tickMm - Math.round(labelMm / tickMm))).toBeLessThan(1e-9);
      }
  });
});

describe("rulerTicks", () => {
  it("measures from the page's corner, numbering the major ticks", () => {
    // 8 px per mm (1 mm ticks, numbers every 10 mm), the page corner 20 px in, 100 px long.
    const ticks = rulerTicks("mm", 8, 20, 100);
    expect(ticks[0].px).toBe(4); // -2 mm
    expect(ticks.find((t) => t.px === 20)).toEqual({ px: 20, size: "major", label: "0" });
    expect(ticks.find((t) => t.px === 100)).toEqual({ px: 100, size: "major", label: "10" });
    expect(ticks.find((t) => t.px === 60)?.size).toBe("middle");
    expect(ticks.find((t) => t.px === 28)).toEqual({ px: 28, size: "minor", label: null });
    expect(ticks).toHaveLength(13);
    // Coarser: 5 mm ticks between numbers every 10 mm have no middle.
    expect(rulerTicks("mm", 4, 0, 40).map((t) => t.size)).toEqual(["major", "minor", "major"]);
  });

  it("counts down before the corner, and shows centimetres and inches as whole numbers", () => {
    expect(rulerTicks("mm", 4, 60, 70).find((t) => t.px === 20)?.label).toBe("-10");
    expect(
      rulerTicks("cm", 4, 0, 200)
        .filter((t) => t.label)
        .map((t) => t.label),
    ).toEqual(["0", "1", "2", "3", "4", "5"]);
    const inch = rulerTicks("in", 100 / MM_PER_INCH, 0, 250);
    expect(inch.filter((t) => t.label).map((t) => t.label)).toEqual(["0", "1", "2"]);
    expect(inch.filter((t) => t.label).map((t) => t.px)).toEqual([0, 100, 200]);
    expect(inch.find((t) => Math.abs(t.px - 50) < 1e-9)?.size).toBe("middle");
  });

  it("draws nothing for an empty ruler", () => {
    expect(rulerTicks("mm", 4, 0, 0)).toEqual([]);
    expect(rulerTicks("mm", 0, 0, 100)).toEqual([]);
  });
});
