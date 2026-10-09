import { describe, expect, it } from "vitest";
import { clipUrl, WELCOME_STEPS, WELCOME_VERSION } from "./welcome";

// The clips the app ships (made by scripts/encode-welcome.sh, which also keeps them inside the size budget) and the
// masters they are made from, found without reading them.
const shipped = Object.keys(import.meta.glob("/public/welcome/*", { query: "?url", import: "default" }));
const masters = Object.keys(import.meta.glob("/assets/welcome/*.mp4", { query: "?url", import: "default" }));

describe("the welcome tour's clips", () => {
  it("are four steps, in the order of the masters, each with its own words", () => {
    expect(WELCOME_STEPS.map((s) => [s.id, s.clip])).toEqual([
      ["cut", "01-cut"],
      ["place", "02-place"],
      ["arrange", "03-arrange"],
      ["done", "04-done"],
    ]);
    expect(WELCOME_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("are shipped as webm, mp4 and a poster, from the masters in assets/welcome", () => {
    for (const step of WELCOME_STEPS) {
      expect(masters).toContain(`/assets/welcome/${step.clip}.mp4`);
      for (const ext of ["webm", "mp4", "png"] as const) expect(shipped).toContain(`/public${clipUrl(step.clip, ext)}`);
    }
  });

  it("have a clip URL under /welcome, which is where Vite serves public/welcome", () => {
    expect(clipUrl("01-cut", "webm")).toBe("/welcome/01-cut.webm");
  });
});
