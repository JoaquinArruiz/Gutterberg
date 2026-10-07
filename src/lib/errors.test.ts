import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import { appError, formatError, isSupersededError, toAppError, toAppErrorOrNull } from "./errors";
import { setDecimalSeparator } from "./locale";

const doesNotFit = {
  code: "does_not_fit",
  message: "laid-out cards need 298.0 x 186.2 mm but the output page is only 210.0 x 297.0 mm",
  needed_w_mm: 298,
  needed_h_mm: 186.2,
  page_w_mm: 210,
  page_h_mm: 297,
};

afterEach(async () => {
  await i18n.changeLanguage("en");
  setDecimalSeparator(".");
});

describe("toAppError", () => {
  it("reads the engine's { code, message, ...values }", () => {
    expect(toAppError({ code: "page_out_of_range", message: "x", page: 5, count: 3 })).toEqual({
      code: "page_out_of_range",
      message: "x",
      values: { page: 5, count: 3 },
    });
  });

  it("keeps a plain string or a JS error as its message, with no code", () => {
    expect(toAppError("boom")).toEqual({ code: null, message: "boom", values: {} });
    expect(toAppError(new Error("bad")).message).toBe("bad");
    expect(toAppError(new Error("bad")).code).toBeNull();
  });

  it("keeps no error as no error", () => {
    expect(toAppErrorOrNull(null)).toBeNull();
    expect(toAppErrorOrNull(undefined)).toBeNull();
    expect(toAppErrorOrNull("x")?.message).toBe("x");
  });

  it("recognises a superseded render in either shape", () => {
    expect(isSupersededError({ code: "superseded", message: "superseded" })).toBe(true);
    expect(isSupersededError("superseded")).toBe(true);
    expect(isSupersededError({ code: "pdfium", message: "x", detail: "y" })).toBe(false);
  });
});

describe("formatError", () => {
  it("words a code from the catalog, with its values", () => {
    expect(formatError(toAppError(doesNotFit))).toBe(
      "The laid-out pieces need 298.0 × 186.2 mm but the sheet is only 210.0 × 297.0 mm.",
    );
  });

  it("speaks Spanish, with the comma when that is the separator", async () => {
    await i18n.changeLanguage("es");
    setDecimalSeparator(",");
    expect(formatError(toAppError(doesNotFit))).toBe(
      "Las piezas dispuestas necesitan 298,0 × 186,2 mm, pero la hoja mide solo 210,0 × 297,0 mm.",
    );
  });

  it("falls back to the English text for a code it does not know, so nothing is blank", async () => {
    const unknown = toAppError({ code: "brand_new_problem", message: "Something new went wrong" });
    expect(formatError(unknown)).toBe("Something new went wrong");
    await i18n.changeLanguage("es");
    expect(formatError(unknown)).toBe("Something new went wrong");
  });

  it("shows a plain message as it is", () => {
    expect(formatError(toAppError("plain"))).toBe("plain");
  });

  it("puts the page first when an export stopped at one", () => {
    const e = toAppError({ ...doesNotFit, at_page: 4 });
    expect(formatError(e).startsWith("Page 4: The laid-out pieces need")).toBe(true);
  });

  it("words the errors the UI makes itself", async () => {
    const e = appError("no_region", "no piece region is selected");
    expect(formatError(e)).toBe("No piece region is selected.");
    await i18n.changeLanguage("es");
    expect(formatError(e)).toBe("No hay ninguna región de piezas seleccionada.");
  });
});
