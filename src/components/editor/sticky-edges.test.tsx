// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentToScreen, type NormalizedRect, type Point, pageScreenRect } from "../../lib/coordinates";
import { RELEASE_PX } from "../../lib/snap";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { EditorViewport } from "./EditorViewport";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
// One edge in the artwork, down the page at x = 0.3 of its width, from the top to near the bottom.
const EDGE_X = 0.3;
const pageEdges = vi.fn(async (_doc: number, _page: number) => ({
  vertical: [{ x: EDGE_X * A4.width_pt, y0: 0.1 * A4.height_pt, y1: 0.9 * A4.height_pt, strength: 1 }],
  horizontal: [],
}));

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
  renderRegion: vi.fn(async () => "blob:crop"),
}));
vi.mock("../../lib/edges-api", () => ({ pageEdges: (d: number, p: number) => pageEdges(d, p) }));

const editor = () => useEditorStore.getState();
const svg = () => screen.getByRole("img", { name: "Page canvas" });
const at = (p: Point, extra: Record<string, unknown> = {}) => {
  const s = documentToScreen(p, editor().viewport, A4);
  return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1, ...extra };
};
const region = (): NormalizedRect | null => {
  const g = useLayoutStore.getState().groups[0];
  return g.kind === "grid" ? g.selection : null;
};
/** Screen pixels as a fraction of the page's width, at the fitted zoom. */
const pxX = (px: number) => px / pageScreenRect(editor().viewport, A4).width;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: 800, height: 1000 } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", MouseEvent);
  Element.prototype.setPointerCapture = () => {};
  pageEdges.mockClear();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(1);
  useLayoutStore.getState().setSelection(0, { x: 0.4, y: 0.2, width: 0.3, height: 0.5 });
  useEditorStore.setState({ tool: "select", pickedRegion: null, viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the viewport and waits for the page's edges. */
async function show() {
  render(<EditorViewport />);
  await act(async () => {});
}

describe("sticky edges", () => {
  it("asks for the page's edges, and not while they are off", async () => {
    await show();
    expect(pageEdges).toHaveBeenCalledWith(0, 0);
    cleanup();
    pageEdges.mockClear();
    usePreferencesStore.getState().setSnapEdges(false);
    await show();
    expect(pageEdges).not.toHaveBeenCalled();
  });

  it("sticks a region's side to an edge, holds it, and lets go after RELEASE_PX", async () => {
    // The magnet off: only the edge pulls.
    usePreferencesStore.getState().setSnap(false);
    await show();
    const body = document.querySelector('[data-hit="body"]') as Element;
    const start = { x: 0.5, y: 0.4 };
    fireEvent.pointerDown(body, at(start));
    // The left side (0.4) moved to 2 px right of the edge: it sticks.
    const near = start.x - 0.1 + pxX(2);
    fireEvent.pointerMove(svg(), at({ x: near, y: 0.4 }));
    expect(region()?.x).toBeCloseTo(EDGE_X, 9);
    expect(screen.getByTestId("snap-guides")).toBeTruthy();
    // On by a little more than the snap distance, but less than RELEASE_PX: still stuck.
    fireEvent.pointerMove(svg(), at({ x: near + pxX(RELEASE_PX - 2), y: 0.4 }));
    expect(region()?.x).toBeCloseTo(EDGE_X, 9);
    // Past RELEASE_PX from where it stuck: it follows the pointer again.
    const away = near + pxX(RELEASE_PX + 2);
    fireEvent.pointerMove(svg(), at({ x: away, y: 0.4 }));
    expect(region()?.x).toBeCloseTo(away - 0.1, 6);
    fireEvent.pointerUp(svg(), at({ x: away, y: 0.4 }));
  });

  it("does not stick when sticky edges are off or Ctrl is held", async () => {
    usePreferencesStore.getState().setSnap(false);
    usePreferencesStore.getState().setSnapEdges(false);
    await show();
    const body = document.querySelector('[data-hit="body"]') as Element;
    fireEvent.pointerDown(body, at({ x: 0.5, y: 0.4 }));
    const near = 0.4 + pxX(2);
    fireEvent.pointerMove(svg(), at({ x: near, y: 0.4 }));
    expect(region()?.x).toBeCloseTo(near - 0.1, 6);
    fireEvent.pointerUp(svg(), at({ x: near, y: 0.4 }));

    act(() => usePreferencesStore.getState().setSnapEdges(true));
    await act(async () => {});
    const body2 = document.querySelector('[data-hit="body"]') as Element;
    const from = { x: near, y: 0.4 };
    fireEvent.pointerDown(body2, at(from));
    fireEvent.pointerMove(svg(), at({ x: from.x + pxX(1), y: 0.4 }, { ctrlKey: true }));
    expect(region()?.x).toBeCloseTo(near - 0.1 + pxX(1), 6);
    fireEvent.pointerUp(svg(), at({ x: from.x + pxX(1), y: 0.4 }));
  });

  it("ignores an edge that runs along less than half of the side", async () => {
    pageEdges.mockResolvedValueOnce({
      vertical: [{ x: EDGE_X * A4.width_pt, y0: 0.2 * A4.height_pt, y1: 0.3 * A4.height_pt, strength: 1 }],
      horizontal: [],
    });
    usePreferencesStore.getState().setSnap(false);
    await show();
    const body = document.querySelector('[data-hit="body"]') as Element;
    fireEvent.pointerDown(body, at({ x: 0.5, y: 0.4 }));
    const near = 0.4 + pxX(2);
    fireEvent.pointerMove(svg(), at({ x: near, y: 0.4 }));
    expect(region()?.x).toBeCloseTo(near - 0.1, 6);
  });

  it("sticks the corner being drawn to an edge", async () => {
    usePreferencesStore.getState().setSnap(false);
    useLayoutStore.getState().setSelection(0, null);
    await show();
    fireEvent.pointerDown(svg(), at({ x: 0.1, y: 0.2 }));
    fireEvent.pointerMove(svg(), at({ x: EDGE_X + pxX(3), y: 0.7 }));
    expect(region()?.x).toBeCloseTo(0.1, 6);
    expect((region()?.x ?? 0) + (region()?.width ?? 0)).toBeCloseTo(EDGE_X, 9);
  });
});
