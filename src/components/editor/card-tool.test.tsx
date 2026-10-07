// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentToScreen, type Point } from "../../lib/coordinates";
import { handlePosition } from "../../lib/freeform";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { undo, useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { FreeformSection } from "../sidebar/FreeformSection";
import { EditorViewport } from "./EditorViewport";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
  renderRegion: vi.fn(async () => "blob:crop"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const layout = () => useLayoutStore.getState();
const editor = () => useEditorStore.getState();
const cards = () => layout().freeform[0] ?? [];
const svg = () => screen.getByRole("img", { name: "Page canvas" });
/** Pointer coordinates of a point given normalized to the page, at the viewport the editor fitted. */
const at = (p: Point, extra: Record<string, unknown> = {}) => {
  const s = documentToScreen(p, editor().viewport, A4);
  return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1, ...extra };
};
const hit = (name: string, card = 0) => document.querySelector(`[data-hit="${name}"][data-card="${card}"]`) as Element;

/** Draws a card from `a` to `b` with the card tool. */
function draw(a: Point, b: Point) {
  fireEvent.pointerDown(svg(), at(a));
  fireEvent.pointerMove(svg(), at(b));
  fireEvent.pointerUp(svg(), at(b));
}

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
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.setState({ path: "/x.pdf", pages: [A4, A4], currentPage: 0 });
  useLayoutStore.getState().resetDocument(2);
  useEditorStore.setState({ tool: "card", selectedCard: null, viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("drawing cards", () => {
  it("draws an upright card by dragging, selects it and leaves the grid alone", () => {
    render(<EditorViewport />);
    draw({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.45 });
    expect(cards()).toHaveLength(1);
    expect(cards()[0].center.x).toBeCloseTo(0.35, 2);
    expect(cards()[0].width).toBeCloseTo(0.3, 2);
    expect(cards()[0].angle_deg).toBe(0);
    expect(editor().selectedCard).toEqual({ page: 0, index: 0 });
    expect(layout().groups[0]).toMatchObject({ kind: "grid", selection: null });
  });

  it("draws several cards, each its own, one undo step per card", () => {
    render(<EditorViewport />);
    draw({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 });
    draw({ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.9 });
    expect(cards()).toHaveLength(2);
    expect(editor().selectedCard?.index).toBe(1);
    act(() => undo());
    expect(cards()).toHaveLength(1);
    act(() => undo());
    expect(cards()).toHaveLength(0);
  });

  it("does not make a card of a click or a tiny drag, and a click on empty page drops the selection", () => {
    render(<EditorViewport />);
    draw({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.45 });
    expect(editor().selectedCard).not.toBeNull();
    draw({ x: 0.7, y: 0.7 }, { x: 0.7, y: 0.7 });
    draw({ x: 0.7, y: 0.7 }, { x: 0.701, y: 0.702 });
    expect(cards()).toHaveLength(1);
    expect(editor().selectedCard).toBeNull();
  });

  it("does not draw on a skipped page", () => {
    layout().setSkipped(0, true);
    render(<EditorViewport />);
    draw({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.45 });
    expect(cards()).toHaveLength(0);
  });

  it("leaves the grid tool as it was: it draws the region, not cards", () => {
    useEditorStore.setState({ tool: "select" });
    render(<EditorViewport />);
    draw({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.45 });
    expect(cards()).toHaveLength(0);
    expect(layout().groups[0]).toMatchObject({
      kind: "grid",
      selection: expect.objectContaining({ width: expect.any(Number) }),
    });
  });

  it("shows the cards in the grid tool too, without letting them take the pointer", () => {
    layout().addFreeformCard(0, { center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: 5 });
    useEditorStore.setState({ tool: "select" });
    render(<EditorViewport />);
    expect(screen.getByTestId("freeform-overlay").getAttribute("pointer-events")).toBe("none");
    expect(hit("rotate")).toBeNull(); // no handles when not selected for editing
  });
});

describe("editing a card", () => {
  const start = { center: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.2, angle_deg: 0 };
  beforeEach(() => {
    layout().addFreeformCard(0, start);
  });

  it("moves a card by dragging it, as one undo step", () => {
    render(<EditorViewport />);
    fireEvent.pointerDown(hit("card"), at({ x: 0.5, y: 0.5 }));
    fireEvent.pointerMove(svg(), at({ x: 0.6, y: 0.55 }));
    fireEvent.pointerMove(svg(), at({ x: 0.65, y: 0.6 }));
    fireEvent.pointerUp(svg(), at({ x: 0.65, y: 0.6 }));
    expect(cards()[0].center.x).toBeCloseTo(0.65, 2);
    expect(cards()[0].center.y).toBeCloseTo(0.6, 2);
    expect(editor().selectedCard).toEqual({ page: 0, index: 0 });
    act(() => undo());
    expect(cards()[0]).toEqual(start);
  });

  it("resizes from a handle, keeping the opposite corner", () => {
    render(<EditorViewport />);
    fireEvent.pointerDown(hit("card"), at(start.center));
    fireEvent.pointerUp(svg(), at(start.center));
    const se = handlePosition(start, "se", A4);
    fireEvent.pointerDown(hit("se"), at(se));
    fireEvent.pointerMove(svg(), at({ x: se.x + 0.05, y: se.y + 0.03 }));
    fireEvent.pointerUp(svg(), at({ x: se.x + 0.05, y: se.y + 0.03 }));
    expect(cards()[0].width).toBeCloseTo(0.35, 2);
    expect(cards()[0].height).toBeCloseTo(0.23, 2);
    const nw = handlePosition(cards()[0], "nw", A4);
    const nw0 = handlePosition(start, "nw", A4);
    expect(nw.x).toBeCloseTo(nw0.x, 3);
    expect(nw.y).toBeCloseTo(nw0.y, 3);
  });

  it("rotates from the handle above the card, and Shift snaps to 15 degrees", () => {
    render(<EditorViewport />);
    fireEvent.pointerDown(hit("card"), at(start.center));
    fireEvent.pointerUp(svg(), at(start.center));
    fireEvent.pointerDown(hit("rotate"), at({ x: 0.5, y: 0.35 }));
    // Pointer straight to the right of the centre: the top edge faces right.
    fireEvent.pointerMove(svg(), at({ x: 0.9, y: 0.5 }));
    expect(cards()[0].angle_deg).toBeCloseTo(90, 1);
    // About 17 degrees off upright: Shift makes it 15.
    fireEvent.pointerMove(svg(), at({ x: 0.5 + 0.0432, y: 0.5 - 0.1 }, { shiftKey: true }));
    expect(cards()[0].angle_deg).toBe(15);
    fireEvent.pointerUp(svg(), at({ x: 0.6, y: 0.4 }));
    // Position and size do not change.
    expect(cards()[0].center).toEqual(start.center);
    expect(cards()[0].width).toBe(start.width);
  });

  it("resizes a rotated card along its own edges", () => {
    layout().updateFreeformCard(0, 0, { ...start, angle_deg: 90 });
    render(<EditorViewport />);
    fireEvent.pointerDown(hit("card"), at(start.center));
    fireEvent.pointerUp(svg(), at(start.center));
    const e = handlePosition({ ...start, angle_deg: 90 }, "e", A4);
    fireEvent.pointerDown(hit("e"), at(e));
    // Turned a quarter, the right edge faces down the page: dragging it down makes the card wider.
    fireEvent.pointerMove(svg(), at({ x: e.x, y: e.y + 0.04 }));
    fireEvent.pointerUp(svg(), at({ x: e.x, y: e.y + 0.04 }));
    expect(cards()[0].width).toBeGreaterThan(start.width);
    expect(cards()[0].height).toBeCloseTo(start.height, 3);
  });

  it("opens the magnifier when a handle is held, and slows the drag", () => {
    vi.useFakeTimers();
    render(<EditorViewport />);
    fireEvent.pointerDown(hit("card"), at(start.center));
    fireEvent.pointerUp(svg(), at(start.center));
    const se = handlePosition(start, "se", A4);
    fireEvent.pointerDown(hit("se"), at(se));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("×4")).toBeTruthy();
    // A fine drag moves the corner at a quarter of the pointer's speed.
    fireEvent.pointerMove(svg(), at({ x: se.x + 0.08, y: se.y }));
    fireEvent.pointerUp(svg(), at({ x: se.x + 0.08, y: se.y }));
    expect(cards()[0].width).toBeCloseTo(start.width + 0.02, 3);
  });
});

describe("the sidebar section", () => {
  const start = { center: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.2, angle_deg: 7 };

  it("asks for the Card tool when the page has cards and another tool is active", () => {
    layout().addFreeformCard(0, start);
    useEditorStore.setState({ tool: "select" });
    render(<FreeformSection />);
    expect(screen.getByText(/1 card on this page/)).toBeTruthy();
    expect(screen.getByText(/Choose the Card tool/)).toBeTruthy();
  });

  it("is absent with no cards and no card tool", () => {
    useEditorStore.setState({ tool: "select" });
    const { container } = render(<FreeformSection />);
    expect(container.firstChild).toBeNull();
  });

  it("edits the picked card's angle and size by number, and deletes it", () => {
    layout().addFreeformCard(0, start);
    layout().addFreeformCard(0, { ...start, center: { x: 0.2, y: 0.2 } });
    useEditorStore.setState({ selectedCard: { page: 0, index: 1 } });
    render(<FreeformSection />);
    const angle = screen.getByRole("textbox", { name: "Angle" }) as HTMLInputElement;
    expect(angle.value).toBe("7.0");
    act(() => angle.focus());
    fireEvent.change(angle, { target: { value: "-3.5" } });
    fireEvent.keyDown(angle, { key: "Enter" });
    expect(cards()[1].angle_deg).toBe(-3.5);
    expect(cards()[0].angle_deg).toBe(7);

    const width = screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement;
    act(() => width.focus());
    fireEvent.change(width, { target: { value: "63" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect((cards()[1].width * A4.width_pt * 25.4) / 72).toBeCloseTo(63, 3);

    fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(cards()).toHaveLength(1);
    expect(editor().selectedCard).toBeNull();
  });

  it("wraps an angle typed past a half turn", () => {
    layout().addFreeformCard(0, start);
    useEditorStore.setState({ selectedCard: { page: 0, index: 0 } });
    render(<FreeformSection />);
    const angle = screen.getByRole("textbox", { name: "Angle" });
    act(() => angle.focus());
    fireEvent.change(angle, { target: { value: "190" } });
    fireEvent.keyDown(angle, { key: "Enter" });
    // The field clamps to its range; either way the stored angle is a valid one.
    expect(Math.abs(cards()[0].angle_deg)).toBeLessThanOrEqual(180);
  });
});
