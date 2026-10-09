import { describe, expect, it } from "vitest";
import { describeSystem, formatAppInfo } from "./app-info";

describe("the app info", () => {
  it("names the system as people do", () => {
    expect(describeSystem("windows", "10.0.22631", "x86_64")).toBe("Windows 11 (x86_64)");
    expect(describeSystem("windows", "10.0.19045", "x86_64")).toBe("Windows 10 (x86_64)");
    expect(describeSystem("macos", "15.0.1", "aarch64")).toBe("macOS 15.0.1 (aarch64)");
    expect(describeSystem("linux", "24.04", "x86_64")).toBe("Linux 24.04 (x86_64)");
    expect(describeSystem("freebsd", "14", "")).toBe("freebsd 14");
  });

  it("is one line, with the pdfium build when it is known", () => {
    const info = { name: "Gutterberg", version: "1.0.0", os: "Windows 11 (x86_64)", language: "es", pdfium: "8086" };
    expect(formatAppInfo(info)).toBe("Gutterberg 1.0.0 · Windows 11 (x86_64) · Language: es · pdfium 8086");
    expect(formatAppInfo({ ...info, pdfium: "" })).toBe("Gutterberg 1.0.0 · Windows 11 (x86_64) · Language: es");
  });
});
