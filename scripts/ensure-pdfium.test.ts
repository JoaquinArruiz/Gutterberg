import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { libraryName, pdfiumTarget, plan } from "./ensure-pdfium.mjs";

describe("pdfiumTarget", () => {
  it("maps each machine with a prebuilt pdfium to the target fetch-pdfium.sh takes", () => {
    expect(pdfiumTarget("linux", "x64")).toBe("linux-x64");
    expect(pdfiumTarget("linux", "arm64")).toBe("linux-arm64");
    expect(pdfiumTarget("darwin", "x64")).toBe("mac-x64");
    expect(pdfiumTarget("darwin", "arm64")).toBe("mac-arm64");
    expect(pdfiumTarget("win32", "x64")).toBe("win-x64");
  });

  it("has none for other machines", () => {
    expect(pdfiumTarget("freebsd", "x64")).toBeNull();
    expect(pdfiumTarget("win32", "arm64")).toBeNull();
  });
});

describe("libraryName", () => {
  it("is the file each system loads", () => {
    expect(libraryName("linux")).toBe("libpdfium.so");
    expect(libraryName("darwin")).toBe("libpdfium.dylib");
    expect(libraryName("win32")).toBe("pdfium.dll");
  });
});

describe("plan", () => {
  const base = { env: {}, platform: "linux", arch: "x64", exists: false };

  it("fetches when pdfium is missing", () => {
    expect(plan(base)).toEqual({ action: "fetch", target: "linux-x64" });
  });

  it("does nothing when the library is there, or the user manages pdfium or opted out", () => {
    expect(plan({ ...base, exists: true }).action).toBe("skip");
    expect(plan({ ...base, env: { PDFIUM_LIB_PATH: "/opt/pdfium" } }).action).toBe("skip");
    expect(plan({ ...base, env: { GUTTERBERG_SKIP_PDFIUM_FETCH: "1" } }).action).toBe("skip");
  });

  it("says so on a machine with no prebuilt pdfium", () => {
    expect(plan({ ...base, platform: "freebsd" })).toEqual({ action: "unsupported" });
  });
});
