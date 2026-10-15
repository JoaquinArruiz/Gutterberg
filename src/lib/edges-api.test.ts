import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import fixtureText from "../../crates/card-core/tests/data/page_edges.json?raw";
import { forgetPageEdges, PageEdgesSchema, pageEdges } from "./edges-api";

const EDGES = {
  vertical: [{ x: 10, y0: 20, y1: 200, strength: 1 }],
  horizontal: [{ y: 20, x0: 10, x1: 150, strength: 0.6 }],
};

beforeEach(() => {
  invoke.mockReset();
  forgetPageEdges();
});

describe("pageEdges", () => {
  it("asks once per page and keeps the answer", async () => {
    invoke.mockResolvedValue(EDGES);
    expect(await pageEdges(1, 0)).toEqual(EDGES);
    expect(await pageEdges(1, 0)).toEqual(EDGES);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("page_edges", { documentId: 1, pageIndex: 0 });
    await pageEdges(1, 1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failure, and after the document is forgotten", async () => {
    invoke.mockRejectedValueOnce(new Error("no document"));
    await expect(pageEdges(2, 0)).rejects.toThrow();
    invoke.mockResolvedValue(EDGES);
    await pageEdges(2, 0);
    await pageEdges(3, 0);
    forgetPageEdges(2);
    await pageEdges(2, 0);
    await pageEdges(3, 0);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("refuses an answer of the wrong shape", async () => {
    invoke.mockResolvedValue({ vertical: [{ x: "1" }], horizontal: [] });
    await expect(pageEdges(4, 0)).rejects.toThrow();
  });
});

describe("PageEdgesSchema", () => {
  it("reads what card-core writes (the fixture its own test round-trips)", () => {
    const edges = PageEdgesSchema.parse(JSON.parse(fixtureText));
    expect(edges.vertical).toHaveLength(2);
    expect(edges.horizontal[0]).toEqual({ y: 85.04, x0: 56.69, x1: 255.12, strength: 1 });
  });
});
