import { describe, expect, it, vi } from "vitest";
import { ImageCache } from "./image-cache";
import { cellWidth, gridColumns, rowCount, visibleRows } from "./virtual-grid";

describe("virtual grid", () => {
  it("fits as many columns as the width allows, at least one", () => {
    expect(gridColumns(400, 90, 8)).toBe(4);
    expect(gridColumns(30, 90, 8)).toBe(1);
    expect(gridColumns(98, 90, 8)).toBe(1);
    expect(gridColumns(188, 90, 8)).toBe(2);
  });

  it("shares the width between the cells", () => {
    expect(cellWidth(400, 4, 8)).toBe(94);
    expect(cellWidth(10, 4, 8)).toBe(0);
  });

  it("counts rows", () => {
    expect([rowCount(0, 4), rowCount(4, 4), rowCount(5, 4)]).toEqual([0, 1, 2]);
  });

  it("mounts only the rows near the viewport", () => {
    // 1000 rows of 100 px, a 300 px viewport scrolled to row 50.
    expect(visibleRows(5000, 300, 100, 1000, 0)).toEqual({ first: 50, last: 52 });
    expect(visibleRows(5000, 300, 100, 1000, 2)).toEqual({ first: 48, last: 54 });
  });

  it("stays inside the rows that exist", () => {
    expect(visibleRows(0, 300, 100, 1000, 2)).toEqual({ first: 0, last: 4 });
    expect(visibleRows(99_000, 300, 100, 1000, 2)).toEqual({ first: 988, last: 994 });
    expect(visibleRows(99_900, 300, 100, 1000, 2).last).toBe(999);
    expect(visibleRows(500_000, 300, 100, 1000, 0).first).toBe(999);
    expect(visibleRows(0, 300, 100, 2, 2)).toEqual({ first: 0, last: 1 });
  });

  it("mounts nothing for an empty grid", () => {
    expect(visibleRows(0, 300, 100, 0).last).toBeLessThan(visibleRows(0, 300, 100, 0).first);
  });
});

describe("ImageCache", () => {
  it("renders each key once and shares the pending render", async () => {
    const cache = new ImageCache(5, () => {});
    const make = vi.fn(async () => "blob:a");
    const [a, b] = await Promise.all([cache.get("a", make), cache.get("a", make)]);
    expect([a, b]).toEqual(["blob:a", "blob:a"]);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used image and releases it later", async () => {
    vi.useFakeTimers();
    const released: string[] = [];
    const cache = new ImageCache(2, (u) => released.push(u));
    await cache.get("a", async () => "blob:a");
    await cache.get("b", async () => "blob:b");
    await cache.get("a", async () => "never"); // touch a: b is now the oldest
    await cache.get("c", async () => "blob:c");
    expect(cache.size).toBe(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect(released).toEqual(["blob:b"]);
    // b is rendered again when asked for, a is still cached.
    const again = vi.fn(async () => "blob:b2");
    expect(await cache.get("b", again)).toBe("blob:b2");
    expect(again).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not keep a failed render", async () => {
    const cache = new ImageCache(5, () => {});
    await expect(cache.get("x", () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await Promise.resolve();
    expect(cache.size).toBe(0);
    expect(await cache.get("x", async () => "blob:x")).toBe("blob:x");
  });

  it("releases everything on clear", async () => {
    const released: string[] = [];
    const cache = new ImageCache(5, (u) => released.push(u));
    await cache.get("a", async () => "blob:a");
    await cache.get("b", async () => "blob:b");
    cache.clear();
    await Promise.resolve();
    await Promise.resolve();
    expect(released.sort()).toEqual(["blob:a", "blob:b"]);
    expect(cache.size).toBe(0);
  });
});
