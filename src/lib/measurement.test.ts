import { describe, expect, it } from "vitest";
import {
  convertFromCanonical, convertToCanonical, formatMeasurement, formatValue, MEASUREMENT_UNITS,
} from "./measurement";

describe("measurement", () => {
  it("25.4 mm = 2.54 cm = 1 in", () => {
    expect(convertFromCanonical(25.4, "mm")).toBe(25.4);
    expect(convertFromCanonical(25.4, "cm")).toBeCloseTo(2.54, 12);
    expect(convertFromCanonical(25.4, "in")).toBeCloseTo(1, 12);
  });

  it("round-trips every unit without drift", () => {
    for (const mm of [3, 63.5, 88, 0.1, 8.999999, 297]) {
      for (const u of MEASUREMENT_UNITS) {
        expect(convertToCanonical(convertFromCanonical(mm, u), u)).toBeCloseTo(mm, 10);
      }
    }
  });

  it("switching units repeatedly only reformats; the canonical value is never rewritten", () => {
    const canonical = 3; // mm, held by the document
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) for (const u of MEASUREMENT_UNITS) seen.push(formatMeasurement(canonical, u));
    expect(canonical).toBe(3);
    expect(seen.slice(0, 3)).toEqual(["3.00 mm", "0.300 cm", "0.118 in"]);
    // same text every time around: no accumulated rounding
    expect(new Set(seen).size).toBe(3);
  });

  it("formats 63.5 mm as 2.500 in", () => {
    expect(formatValue(63.5, "in")).toBe("2.500");
  });

  it("only rounds the display", () => {
    expect(formatValue(2.99999999, "mm", 1)).toBe("3.0");
    expect(convertFromCanonical(2.99999999, "mm")).toBe(2.99999999);
  });
});
