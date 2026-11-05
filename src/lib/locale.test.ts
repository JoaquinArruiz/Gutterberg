import { afterEach, describe, expect, it } from "vitest";
import { decimalSeparator, type Language, resolveLanguage, resolveSeparator, setDecimalSeparator } from "./locale";

describe("resolveLanguage", () => {
  it("uses a chosen language as it is", () => {
    expect(resolveLanguage("es", "en-US")).toBe("es");
    expect(resolveLanguage("en", "es-MX")).toBe("en");
  });

  it("follows the system language for System, with any region", () => {
    expect(resolveLanguage("system", "es")).toBe("es");
    expect(resolveLanguage("system", "es-MX")).toBe("es");
    expect(resolveLanguage("system", "ES-419")).toBe("es");
    expect(resolveLanguage("system", "en-GB")).toBe("en");
  });

  it("falls back to English for a language it does not have, or none", () => {
    expect(resolveLanguage("system", "fr-FR")).toBe("en");
    expect(resolveLanguage("system", "")).toBe("en");
  });
});

describe("resolveSeparator", () => {
  it("takes the language's own for Automatic: comma for Spanish, dot for English", () => {
    expect(resolveSeparator("auto", "es")).toBe(",");
    expect(resolveSeparator("auto", "en")).toBe(".");
  });

  it("asks Intl for a language added later", () => {
    expect(resolveSeparator("auto", "de" as Language)).toBe(",");
    expect(resolveSeparator("auto", "ja" as Language)).toBe(".");
  });

  it("obeys an explicit choice in either language", () => {
    expect(resolveSeparator("dot", "es")).toBe(".");
    expect(resolveSeparator("comma", "en")).toBe(",");
  });
});

describe("the separator in effect", () => {
  afterEach(() => setDecimalSeparator("."));

  it("is set and read back", () => {
    expect(decimalSeparator()).toBe(".");
    setDecimalSeparator(",");
    expect(decimalSeparator()).toBe(",");
  });
});
