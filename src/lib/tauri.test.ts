import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { renderPage, renderRegion, replyBytes } = await import("./tauri");

// The first bytes of every PNG.
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
let blobs: Blob[];

beforeEach(() => {
  invoke.mockReset();
  blobs = [];
  URL.createObjectURL = (b: Blob) => {
    blobs.push(b);
    return `blob:${blobs.length}`;
  };
});

const bytesOf = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe("binary command replies", () => {
  it("keep an ArrayBuffer as it is", () => {
    const buffer = new Uint8Array(PNG).buffer;
    expect(replyBytes(buffer)).toBe(buffer);
  });

  it("turn the postMessage fallback's array of numbers back into bytes", () => {
    expect([...(replyBytes(PNG) as Uint8Array)]).toEqual(PNG);
  });

  it("make a real PNG of a page either way, never the text of the numbers", async () => {
    invoke.mockResolvedValueOnce(new Uint8Array(PNG).buffer).mockResolvedValueOnce(PNG);
    expect(await renderPage("page", 0, 0, 100)).toBe("blob:1");
    expect(await renderRegion("viewport", 0, 0, { x: 0, y: 0, width: 1, height: 1 }, 100)).toBe("blob:2");
    expect(await bytesOf(blobs[0])).toEqual(PNG);
    expect(await bytesOf(blobs[1])).toEqual(PNG);
    expect(blobs[1].type).toBe("image/png");
  });
});
