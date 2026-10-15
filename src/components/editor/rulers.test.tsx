// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentToScreen, type Point } from "../../lib/coordinates";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { EditorViewport } from "./EditorViewport";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
  renderRegion: vi.fn(async () => "blob:crop"),
}));
vi.mock("../../lib/edges-api", () => ({ pageEdges: async () => ({ vertical: [], horizontal: [] }) }));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const svg = () => screen.getByRole("img", { name: "Page canvas" });
const editor = () => useEditorStore.getState();
/** Pointer coordinates of a point given normalized to the page (the canvas's corner is at 0, 0 in jsdom). */
const at = (p: Point) => {
  const s = documentToScreen(p, editor().viewport, A4);
  return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1 };
};
const guides = () => editor().guides[0] ?? { xs: [], ys: [] };

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
  useEditorStore.getState().reset();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(1);
  useEditorStore.setState({ tool: "select", viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("rulers", () => {
  it("are off by default and take no room", () => {
    render(<EditorViewport />);
    expect(screen.queryByTestId("ruler-x")).toBeNull();
    expect(screen.queryByTestId("ruler-y")).toBeNull();
  });

  it("show along the top and the left, numbered from the page's corner in the user's unit", () => {
    usePreferencesStore.getState().setRulers(true);
    render(<EditorViewport />);
    const top = screen.getByTestId("ruler-x");
    expect(screen.getByTestId("ruler-y")).toBeTruthy();
    const labels = () => [...top.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels()).toContain("0");
    expect(labels()).toContain("100");
    act(() => usePreferencesStore.getState().setUnit("in"));
    expect(labels()).toContain("1");
    expect(labels()).not.toContain("100");
  });

  it("mark the pointer's position as it moves over the page, and hide the mark when it leaves", () => {
    usePreferencesStore.getState().setRulers(true);
    render(<EditorViewport />);
    const mark = screen.getByTestId("ruler-x-mark") as unknown as SVGLineElement;
    expect(mark.style.display).toBe("none");
    fireEvent.pointerMove(svg(), { clientX: 120, clientY: 340 });
    expect(mark.style.display).toBe("");
    expect(mark.getAttribute("transform")).toBe("translate(120 0)");
    expect(screen.getByTestId("ruler-y-mark").getAttribute("transform")).toBe("translate(0 340)");
    fireEvent.pointerLeave(svg());
    expect(mark.style.display).toBe("none");
  });

  it("are not shown in the Preview view, which shows the sheet rather than the source page", () => {
    usePreferencesStore.getState().setRulers(true);
    useEditorStore.setState({ viewMode: "output" });
    render(<EditorViewport />);
    expect(screen.queryByTestId("ruler-x")).toBeNull();
  });
});

describe("guides", () => {
  beforeEach(() => usePreferencesStore.getState().setRulers(true));

  it("are dragged out of the rulers, showing their distance from the corner, and kept per PDF", () => {
    render(<EditorViewport />);
    const top = screen.getByTestId("ruler-x");
    fireEvent.pointerDown(top, { clientX: 200, clientY: -8, button: 0, pointerId: 1 });
    fireEvent.pointerMove(top, at({ x: 0.5, y: 0.25 }));
    // 0.25 of A4's height is 74.25 mm.
    expect(screen.getByTestId("guide-drag").textContent).toBe("74.25 mm");
    fireEvent.pointerUp(top, at({ x: 0.5, y: 0.25 }));
    expect(guides().ys[0]).toBeCloseTo(0.25 * A4.height_pt, 6);
    expect(screen.queryByTestId("guide-drag")).toBeNull();

    const left = screen.getByTestId("ruler-y");
    fireEvent.pointerDown(left, { clientX: -8, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(left, at({ x: 0.1, y: 0.5 }));
    fireEvent.pointerUp(left, at({ x: 0.1, y: 0.5 }));
    expect(guides().xs[0]).toBeCloseTo(0.1 * A4.width_pt, 6);
    // Another PDF of the project has its own.
    expect(editor().guides[1]).toBeUndefined();
  });

  it("are not made when let go over their ruler", () => {
    render(<EditorViewport />);
    const top = screen.getByTestId("ruler-x");
    fireEvent.pointerDown(top, { clientX: 200, clientY: -8, button: 0, pointerId: 1 });
    fireEvent.pointerMove(top, { clientX: 200, clientY: -4, pointerId: 1 });
    fireEvent.pointerUp(top, { clientX: 200, clientY: -4, pointerId: 1 });
    expect(guides()).toEqual({ xs: [], ys: [] });
  });

  it("are moved by pressing on them, and deleted by dragging them back onto their ruler", () => {
    editor().setGuides(0, { xs: [], ys: [0.25 * A4.height_pt] });
    render(<EditorViewport />);
    const grab = () => document.querySelector('[data-hit="guide"]') as Element;
    fireEvent.pointerDown(grab(), at({ x: 0.5, y: 0.25 }));
    fireEvent.pointerMove(svg(), at({ x: 0.5, y: 0.4 }));
    fireEvent.pointerUp(svg(), at({ x: 0.5, y: 0.4 }));
    expect(guides().ys[0]).toBeCloseTo(0.4 * A4.height_pt, 6);

    fireEvent.pointerDown(grab(), at({ x: 0.5, y: 0.4 }));
    fireEvent.pointerMove(svg(), { clientX: 300, clientY: -6, pointerId: 1 });
    fireEvent.pointerUp(svg(), { clientX: 300, clientY: -6, pointerId: 1 });
    expect(guides().ys).toEqual([]);
  });

  it("cannot be grabbed with the pan tool", () => {
    editor().setGuides(0, { xs: [100], ys: [] });
    useEditorStore.setState({ tool: "pan" });
    render(<EditorViewport />);
    expect(document.querySelector('[data-hit="guide"]')).toBeNull();
    expect(screen.getByTestId("guides").querySelectorAll("line")).toHaveLength(1);
  });

  it("are snapped to by the region, with the magnet on", () => {
    editor().setGuides(0, { xs: [0.3 * A4.width_pt], ys: [] });
    useLayoutStore.getState().setSelection(0, { x: 0.4, y: 0.2, width: 0.3, height: 0.5 });
    render(<EditorViewport />);
    const body = document.querySelector('[data-hit="body"]') as Element;
    fireEvent.pointerDown(body, at({ x: 0.5, y: 0.4 }));
    fireEvent.pointerMove(svg(), at({ x: 0.403, y: 0.4 }));
    fireEvent.pointerUp(svg(), at({ x: 0.403, y: 0.4 }));
    const g = useLayoutStore.getState().groups[0];
    expect(g.kind === "grid" ? g.selection?.x : null).toBeCloseTo(0.3, 9);
  });

  it("are all cleared from the corner where the rulers meet", () => {
    editor().setGuides(0, { xs: [100], ys: [200, 300] });
    render(<EditorViewport />);
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear guides" }));
    expect(guides()).toEqual({ xs: [], ys: [] });
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    expect((screen.getByRole("menuitem", { name: "Clear guides" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ruler cursors", () => {
  it("show which way the guide from each ruler runs, inverted or not", () => {
    usePreferencesStore.getState().setRulers(true);
    render(<EditorViewport />);
    const cursor = (axis: string) => (screen.getByTestId(`ruler-${axis}`) as unknown as SVGElement).style.cursor;
    expect([cursor("x"), cursor("y")]).toEqual(["row-resize", "col-resize"]);
    act(() => usePreferencesStore.getState().setInvertRulers(true));
    expect([cursor("x"), cursor("y")]).toEqual(["col-resize", "row-resize"]);
  });
});

describe("inverted rulers", () => {
  beforeEach(() => {
    usePreferencesStore.getState().setRulers(true);
    usePreferencesStore.getState().setInvertRulers(true);
  });

  it("make a vertical guide from the top ruler and a horizontal one from the left", () => {
    render(<EditorViewport />);
    const top = screen.getByTestId("ruler-x");
    fireEvent.pointerDown(top, { clientX: 200, clientY: -8, button: 0, pointerId: 1 });
    fireEvent.pointerMove(top, at({ x: 0.3, y: 0.5 }));
    fireEvent.pointerUp(top, at({ x: 0.3, y: 0.5 }));
    expect(guides().xs[0]).toBeCloseTo(0.3 * A4.width_pt, 6);
    expect(guides().ys).toEqual([]);

    const left = screen.getByTestId("ruler-y");
    fireEvent.pointerDown(left, { clientX: -8, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(left, at({ x: 0.5, y: 0.6 }));
    fireEvent.pointerUp(left, at({ x: 0.5, y: 0.6 }));
    expect(guides().ys[0]).toBeCloseTo(0.6 * A4.height_pt, 6);
  });

  it("delete a guide dropped back on the ruler it comes from", () => {
    editor().setGuides(0, { xs: [0.3 * A4.width_pt], ys: [] });
    render(<EditorViewport />);
    const grab = () => document.querySelector('[data-hit="guide"]') as Element;
    // Over the left ruler: a vertical guide comes from the top one, so it stays.
    fireEvent.pointerDown(grab(), at({ x: 0.3, y: 0.5 }));
    fireEvent.pointerMove(svg(), { clientX: -4, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(svg(), { clientX: -4, clientY: 300, pointerId: 1 });
    expect(guides().xs).toHaveLength(1);
    fireEvent.pointerDown(grab(), at({ x: 0.3, y: 0.5 }));
    fireEvent.pointerMove(svg(), { clientX: 200, clientY: -4, pointerId: 1 });
    fireEvent.pointerUp(svg(), { clientX: 200, clientY: -4, pointerId: 1 });
    expect(guides().xs).toEqual([]);
  });
});
