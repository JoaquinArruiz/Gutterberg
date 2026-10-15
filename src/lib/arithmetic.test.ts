import { describe, expect, it } from "vitest";
import { evaluateArithmetic } from "./arithmetic";

describe("evaluateArithmetic", () => {
  it("works out the four operations with the usual precedence", () => {
    expect(evaluateArithmetic("12/3")).toBe(4);
    expect(evaluateArithmetic("2 + 3 * 4")).toBe(14);
    expect(evaluateArithmetic("10 - 4 - 3")).toBe(3);
    expect(evaluateArithmetic("24 / 4 / 2")).toBe(3);
    expect(evaluateArithmetic("(2 + 3) * 4")).toBe(20);
    expect(evaluateArithmetic("((1))")).toBe(1);
  });

  it("reads numbers with a dot or a comma", () => {
    expect(evaluateArithmetic("63,5*2")).toBe(127);
    expect(evaluateArithmetic("63.5 + ,5")).toBe(64);
    expect(evaluateArithmetic("5, + 1")).toBe(6);
  });

  it("takes signs and the typographic minus, times and division signs", () => {
    expect(evaluateArithmetic("-4 + 10")).toBe(6);
    expect(evaluateArithmetic("3 * -2")).toBe(-6);
    expect(evaluateArithmetic("-(2 + 1)")).toBe(-3);
    expect(evaluateArithmetic("−2 + 5")).toBe(3);
    expect(evaluateArithmetic("6 × 2 ÷ 4")).toBe(3);
  });

  it("rejects what is not an expression", () => {
    for (const bad of [
      "",
      " ",
      "abc",
      "6 3",
      "2(3)",
      "(2 + 3",
      "2 + 3)",
      "2 +",
      "* 2",
      "1e3",
      "1,234.5",
      "1.2.3",
      "5mm",
      "Math.PI",
      "2 ** 3",
    ]) {
      expect(evaluateArithmetic(bad), bad).toBeNull();
    }
  });

  it("rejects a division by zero", () => {
    expect(evaluateArithmetic("1/0")).toBeNull();
    expect(evaluateArithmetic("1/(2-2)")).toBeNull();
  });

  it("gives up on parentheses nested too deep instead of throwing", () => {
    expect(evaluateArithmetic(`${"(".repeat(100_000)}1${")".repeat(100_000)}`)).toBeNull();
  });
});
