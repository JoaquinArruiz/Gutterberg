// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardIdKey, freeformCardId, gridCardId } from "../../lib/card";
import type { Card } from "../../lib/sheet-api";
import { mmToPt } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { redo, undo, useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { CardLibrary } from "./CardLibrary";
import { PrintInspector } from "./PrintInspector";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderRegion: vi.fn(async () => "blob:card"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
/** A freeform card of `w` x `h` mm tilted by `angle` degrees: a scan whose cards are not quite lined up. */
const scan = (index: number, w = 63, h = 88, angle = 0): Card => ({
  id: freeformCardId(0, 0, index),
  source: { center: { x: 100 + index * 10, y: 100 }, width: mmToPt(w), height: mmToPt(h), angle_deg: angle },
  scale: 1,
  turn: 0,
});
const key = (c: Card) => cardIdKey(c.id);
const print = () => usePrintStore.getState();
const layout = () => useLayoutStore.getState();
const thumbs = () => Array.from(document.querySelectorAll("button[data-card]")) as HTMLElement[];
const order = () => thumbs().map((t) => t.dataset.card);

function typeNumber(input: HTMLElement, value: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const cards = [scan(0), scan(1, 88, 63), scan(2, 64, 89.4, 7), scan(3)];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: 400, height: 500 } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  usePreferencesStore.getState().resetToDefaults();
  usePrintStore.getState().reset();
  useDocumentStore.setState({ path: "/x.pdf", pages: [A4, A4], currentPage: 0 });
  useLayoutStore.getState().resetDocument(2);
  print().setCards(cards, null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("turning cards in the library", () => {
  it("turns the selected cards with the buttons and keeps going round", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    expect(layout().cardEdits.turns).toEqual({ [key(cards[0])]: 90 });
    expect(thumbs()[0].dataset.turn).toBe("90");
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    expect(layout().cardEdits.turns).toEqual({ [key(cards[0])]: 180 });
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    expect(layout().cardEdits.turns).toEqual({ [key(cards[0])]: 270 });
  });

  it("turns with R and Shift+R, but not while typing in a field", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[1]);
    fireEvent.keyDown(window, { key: "r" });
    expect(layout().cardEdits.turns).toEqual({ [key(cards[1])]: 90 });
    fireEvent.keyDown(window, { key: "R", shiftKey: true });
    expect(layout().cardEdits.turns).toEqual({});
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Show only page" }), { key: "r" });
    expect(layout().cardEdits.turns).toEqual({});
  });

  it("does nothing with no cards selected", () => {
    render(<CardLibrary />);
    expect(screen.getByRole("button", { name: "Turn right" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(window, { key: "r" });
    expect(layout().cardEdits.turns).toEqual({});
  });

  it("makes the selection all portrait, or all landscape", () => {
    render(<CardLibrary />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Make all portrait" }));
    // Only the card that was landscape is turned.
    expect(layout().cardEdits.turns).toEqual({ [key(cards[1])]: 90 });
    fireEvent.click(screen.getByRole("button", { name: "Make all landscape" }));
    expect(Object.keys(layout().cardEdits.turns).sort()).toEqual([key(cards[0]), key(cards[2]), key(cards[3])].sort());
    // The one turned to portrait is landscape again by turning it back, not on.
    expect(layout().cardEdits.turns[key(cards[1])]).toBeUndefined();
  });

  it("is undone and redone like any other edit", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    act(() => undo());
    expect(layout().cardEdits.turns).toEqual({});
    act(() => redo());
    expect(layout().cardEdits.turns).toEqual({ [key(cards[0])]: 90 });
  });

  it("shows a turned card as it will print", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    act(() => {});
    const layer = thumbs()[0].querySelector("img")?.parentElement;
    // The image appears once it has rendered.
    if (layer) expect(layer.style.transform).toContain("rotate(90deg)");
    expect(thumbs()[0].title).toContain("turned 90°");
  });
});

describe("setting a real size", () => {
  const section = () => screen.getByTestId("section-print.cards");

  it("asks for a selection first", () => {
    render(<PrintInspector />);
    expect(within(section()).getByText(/Select pieces in the piece library/)).toBeTruthy();
  });

  it("sets 63 x 88 mm on a card of 64 x 89.4 mm, and shows the percentage everywhere", () => {
    render(
      <>
        <CardLibrary />
        <PrintInspector />
      </>,
    );
    fireEvent.click(thumbs()[2]);
    expect(screen.getByTestId("card-size-summary").textContent).toContain("64.0 × 89.4 mm (100.0%)");
    typeNumber(within(section()).getByRole("textbox", { name: "Width" }), "63");
    const scale = layout().cardEdits.scales[key(cards[2])];
    expect(scale).toBeCloseTo(63 / 64, 6);
    expect(screen.getByTestId("card-size-summary").textContent).toContain("63.0 × 88.0 mm (98.4%)");
    // The library marks the scaled card, and says its size on hover.
    const thumb = thumbs()[2];
    expect(within(thumb).getByTestId("scale-badge").textContent).toBe("98%");
    expect(thumb.title).toContain("63.0 × 88.0 mm (98.4%)");
    // Cards that were not scaled have no badge.
    expect(within(thumbs()[0]).queryByTestId("scale-badge")).toBeNull();
  });

  it("sets a height, or a percentage, and goes back to the page's size", () => {
    render(
      <>
        <CardLibrary />
        <PrintInspector />
      </>,
    );
    fireEvent.click(thumbs()[0]);
    typeNumber(within(section()).getByRole("textbox", { name: "Height" }), "44");
    expect(layout().cardEdits.scales[key(cards[0])]).toBeCloseTo(0.5, 6);
    typeNumber(within(section()).getByRole("textbox", { name: "Scale" }), "90");
    expect(layout().cardEdits.scales[key(cards[0])]).toBeCloseTo(0.9, 6);
    fireEvent.click(within(section()).getByRole("button", { name: "Back to the size on the page" }));
    expect(layout().cardEdits.scales).toEqual({});
    expect(within(thumbs()[0]).queryByTestId("scale-badge")).toBeNull();
  });

  it("gives several cards of one size the same real size, and only a percentage when they differ", () => {
    render(
      <>
        <CardLibrary />
        <PrintInspector />
      </>,
    );
    fireEvent.click(thumbs()[0]);
    fireEvent.click(thumbs()[3], { ctrlKey: true });
    typeNumber(within(section()).getByRole("textbox", { name: "Width" }), "60");
    expect(layout().cardEdits.scales[key(cards[0])]).toBeCloseTo(60 / 63, 6);
    expect(layout().cardEdits.scales[key(cards[3])]).toBeCloseTo(60 / 63, 6);
    fireEvent.click(thumbs()[1], { ctrlKey: true });
    expect(within(section()).getByRole("textbox", { name: "Width" })).toHaveProperty("disabled", true);
    typeNumber(within(section()).getByRole("textbox", { name: "Scale" }), "50");
    expect(layout().cardEdits.scales[key(cards[1])]).toBeCloseTo(0.5, 6);
  });

  it("is undone with Ctrl+Z like every other edit", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    act(() => layout().setCardEdits({ turns: {}, scales: { [key(cards[0])]: 0.5 }, order: [] }));
    act(() => undo());
    expect(layout().cardEdits.scales).toEqual({});
  });
});

describe("sorting cards by dragging", () => {
  /** The thumb under the pointer, as `elementFromPoint` would answer. */
  function pointAt(el: HTMLElement | null, half: "left" | "right") {
    const rect = { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100, x: 0, y: 0 } as DOMRect;
    if (el) el.getBoundingClientRect = () => rect;
    document.elementFromPoint = () => el;
    return { clientX: half === "left" ? 20 : 80, clientY: 50 };
  }

  beforeEach(() => {
    if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", MouseEvent);
  });

  it("moves a card before another, and the sheets follow the new order", () => {
    render(<CardLibrary />);
    const [a, , , d] = thumbs();
    fireEvent.pointerDown(d, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(a, "left"));
    expect(within(a).getByTestId("drop-mark")).toBeTruthy();
    fireEvent.pointerUp(window);
    fireEvent.click(d); // the click that ends a drag is not a selection
    expect(print().selection.selected).toEqual([]);
    expect(layout().cardEdits.order).toEqual([key(cards[3]), key(cards[0]), key(cards[1]), key(cards[2])]);
    expect(order()).toEqual([key(cards[3]), key(cards[0]), key(cards[1]), key(cards[2])]);
  });

  it("drops after a card when the pointer is on its right half", () => {
    render(<CardLibrary />);
    const [a, b] = thumbs();
    fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(b, "right"));
    fireEvent.pointerUp(window);
    expect(order()).toEqual([key(cards[1]), key(cards[0]), key(cards[2]), key(cards[3])]);
  });

  it("drags the whole selection when the pressed card is part of it", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(thumbs()[1], { ctrlKey: true });
    const [a, , , d] = thumbs();
    fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(d, "right"));
    fireEvent.pointerUp(window);
    expect(order()).toEqual([key(cards[2]), key(cards[3]), key(cards[0]), key(cards[1])]);
  });

  it("is not a drag until the pointer has moved, so a click still selects", () => {
    render(<CardLibrary />);
    const [a] = thumbs();
    fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 2, clientY: 1 });
    fireEvent.pointerUp(window);
    fireEvent.click(a);
    expect(layout().cardEdits.order).toEqual([]);
    expect(print().selection.selected).toEqual([key(cards[0])]);
  });

  it("changes nothing when dropped on a card of the selection itself, or on nothing", () => {
    render(<CardLibrary />);
    const [a, b] = thumbs();
    fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(a, "right"));
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(b, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(null, "right"));
    fireEvent.pointerUp(window);
    expect(layout().cardEdits.order).toEqual([]);
  });

  it("is undone as one step", () => {
    render(<CardLibrary />);
    const [a, , , d] = thumbs();
    fireEvent.pointerDown(d, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, pointAt(a, "left"));
    fireEvent.pointerUp(window);
    act(() => undo());
    expect(layout().cardEdits.order).toEqual([]);
    expect(order()).toEqual(cards.map(key));
  });
});

describe("the sheet grid for edited cards", () => {
  it("offers 'same as source' only for cards as the page has them", () => {
    // Grid cards are the default plan; freeform ones, or any edit, need the planner.
    const grid = [0, 1].map((c) => ({ ...cards[0], id: gridCardId(0, 0, 0, c) }));
    print().setCards(grid, null);
    render(<PrintInspector />);
    const select = () => screen.getByRole("combobox", { name: "Sheet grid" }) as HTMLSelectElement | HTMLElement;
    expect(select()).toBeTruthy();
    expect(screen.queryByText(/no freeform/)).toBeNull();
    act(() => layout().setCardEdits({ turns: { [key(grid[0])]: 90 }, scales: {}, order: [] }));
    expect(screen.getByText(/no freeform,/)).toBeTruthy();
  });
});
