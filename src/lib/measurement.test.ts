import { afterEach, describe, expect, it } from "vitest";
import { setDecimalSeparator } from "./locale";
import {
  convertFromCanonical,
  convertToCanonical,
  formatDecimal,
  formatMeasurement,
  formatValue,
  MEASUREMENT_UNITS,
  parseDecimal,
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

describe("decimal separator", () => {
  afterEach(() => setDecimalSeparator("."));

  it("shows measurements with a dot or a comma, never changing the value", () => {
    expect(formatMeasurement(63.5, "mm")).toBe("63.50 mm");
    setDecimalSeparator(",");
    expect(formatMeasurement(63.5, "mm")).toBe("63,50 mm");
    expect(formatValue(63.5, "in")).toBe("2,500");
    expect(formatDecimal(98.4, 1)).toBe("98,4");
    expect(formatDecimal(98.4, 1, ".")).toBe("98.4");
    expect(formatDecimal(3, 0)).toBe("3");
  });
});

describe("parseDecimal", () => {
  it("accepts a dot or a comma whatever the display setting is", () => {
    for (const sep of [".", ","] as const) {
      setDecimalSeparator(sep);
      expect(parseDecimal("63.5")).toBe(63.5);
      expect(parseDecimal("63,5")).toBe(63.5);
    }
    setDecimalSeparator(".");
  });

  it("reads whole numbers, signs, leading and trailing separators and padding", () => {
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("  7,25  ")).toBe(7.25);
    expect(parseDecimal("-3.5")).toBe(-3.5);
    expect(parseDecimal("\u22123,5")).toBe(-3.5);
    expect(parseDecimal("+2")).toBe(2);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("5,")).toBe(5);
  });

  it("rejects a value with both separators or more than one (there are no thousands separators)", () => {
    for (const bad of ["1,234.5", "1.234,5", "1.2.3", "1,2,3", "1,,2", "63..5"])
      expect(parseDecimal(bad), bad).toBeNull();
  });

  it("rejects what is not a number", () => {
    for (const bad of ["", " ", "abc", "6 3", "1e3", "0x10", "--1", ".", ",", "Infinity", "5mm"]) {
      expect(parseDecimal(bad), bad).toBeNull();
    }
  });
});
