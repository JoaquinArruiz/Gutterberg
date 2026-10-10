import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipFormat, clipUrl, forgetLoadedClips, loadClip, WELCOME_STEPS, WELCOME_VERSION } from "./welcome";

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

describe("playing a clip", () => {
  beforeEach(() => {
    forgetLoadedClips();
    let n = 0;
    URL.createObjectURL = () => `blob:${++n}`;
  });

  it("picks the .webm where VP9 plays and the .mp4 elsewhere", () => {
    expect(clipFormat((t) => (t.includes("vp9") ? "probably" : ""))).toBe("webm");
    expect(clipFormat(() => "")).toBe("mp4");
  });

  it("loads a clip into memory once and gives a blob URL", async () => {
    const fetchFile = vi.fn(async () => new Response(new Blob(["clip"])));
    expect(await loadClip("01-cut", "webm", fetchFile)).toBe("blob:1");
    expect(await loadClip("01-cut", "webm", fetchFile)).toBe("blob:1");
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchFile).toHaveBeenCalledWith("/welcome/01-cut.webm");
  });

  it("does not keep a failed load, so the next try fetches again", async () => {
    const fetchFile = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(new Blob(["clip"])));
    await expect(loadClip("01-cut", "mp4", fetchFile)).rejects.toThrow("01-cut.mp4: 404");
    expect(await loadClip("01-cut", "mp4", fetchFile)).toBe("blob:1");
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });
});
