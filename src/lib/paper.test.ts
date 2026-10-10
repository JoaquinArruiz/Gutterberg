import { describe, expect, it } from "vitest";
import { usualPaper } from "./paper";

describe("the usual paper", () => {
  it("is Letter in the regions that use it and A4 elsewhere", () => {
    expect(usualPaper("en-US")).toBe("letter");
    expect(usualPaper("es-MX")).toBe("letter");
    expect(usualPaper("es_CL")).toBe("letter");
    expect(usualPaper("es-AR")).toBe("a4");
    expect(usualPaper("en-GB")).toBe("a4");
    expect(usualPaper("es")).toBe("a4");
    expect(usualPaper("")).toBe("a4");
  });
});
