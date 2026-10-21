import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { ASSETS, fillManifest, msixVersion, packageFiles } from "./make-msix.mjs";

const manifest = readFileSync(join(__dirname, "..", "src-tauri", "msix", "AppxManifest.xml"), "utf8");

describe("the Microsoft Store package", () => {
  it("turns the app's version into four numbers, and leaves pre-releases out", () => {
    expect(msixVersion("1.2.0")).toBe("1.2.0.0");
    expect(msixVersion("v10.0.3")).toBe("10.0.3.0");
    expect(msixVersion("1.2.0-beta.1")).toBeNull();
    expect(msixVersion("1.2")).toBeNull();
    expect(msixVersion("1.70000.0")).toBeNull();
  });

  it("fills in the version and keeps Partner Center's identity", () => {
    const text = fillManifest(manifest, "1.2.0.0");
    expect(text).toContain('Version="1.2.0.0"');
    expect(text).toContain('Name="joaquinarruiz.Gutterberg"');
    expect(text).toContain('Publisher="CN=11D978E9-4283-4274-B6A5-2A5B34C44A34"');
    expect(text).toContain("<PublisherDisplayName>joaquinarruiz</PublisherDisplayName>");
    expect(() => fillManifest("{{VERSION}} {{OTHER}}", "1.0.0.0")).toThrow("{{OTHER}}");
  });

  it("packs every file the manifest names, from files that exist", () => {
    const files = packageFiles({ exe: "app.exe", cli: "cli.exe" });
    const inside = files.map(([, to]: [string, string]) => to.replaceAll("/", "\\"));
    const named = [...manifest.matchAll(/(?:Executable="|>|")((?:Assets\\)?[\w-]+\.(?:exe|png))(?="|<)/g)].map(
      (m) => m[1],
    );
    expect(named.length).toBeGreaterThan(5);
    for (const name of named) expect(inside).toContain(name);
    for (const [from] of files.slice(2)) expect(existsSync(from), from).toBe(true);
    expect(Object.keys(ASSETS).every((a) => inside.includes(`Assets\\${a}`))).toBe(true);
  });
});
