// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardIdKey, gridCardId } from "../../lib/card";
import type { Card, OutputSheet } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";
import { CardLibrary } from "./CardLibrary";
import { PrintInspector } from "./PrintInspector";
import { SheetPreview } from "./SheetPreview";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderRegion: vi.fn(async () => "blob:card"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const card = (row: number, column: number): Card => ({
  id: gridCardId(0, 0, row, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cards = [card(0, 0), card(0, 1), card(1, 0), card(1, 1)];
const key = (c: Card) => cardIdKey(c.id);
const print = () => usePrintStore.getState();
const layout = () => useLayoutStore.getState();

function typeNumber(input: HTMLElement, value: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function choose(selectName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: selectName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
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
  print().reset();
  useUiStore.setState({ stage: "print" });
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4], hash: "" }], 0);
  layout().resetDocument(2);
  print().setCards(cards, null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Print inspector: cut marks, bleed and duplex", () => {
  it("has three sections, folded until opened", () => {
    render(<PrintInspector />);
    for (const name of ["Cut marks", "Bleed", "Duplex"]) {
      const header = screen.getByRole("button", { name });
      expect(header.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByText("Line width")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cut marks" }));
    expect(screen.getByRole("button", { name: "Cut marks" }).getAttribute("aria-expanded")).toBe("true");
    expect(prefsOpen("print.marks")).toBe(true);
  });

  it("sets the marks style and clamps the numbers to what the engine accepts", () => {
    render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Cut marks" }));
    expect(screen.queryByRole("textbox", { name: "Line width" })).toBeNull();
    choose("Style", "Ticks in the margins");
    expect(print().finish.marks.style).toBe("ticks");
    typeNumber(screen.getByRole("textbox", { name: "Line width" }), "50");
    expect(print().finish.marks.widthMm).toBe(2);
    typeNumber(screen.getByRole("textbox", { name: "Tick length" }), "5");
    expect(print().finish.marks.lengthMm).toBe(5);
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "#ff0000" } });
    expect(print().finish.marks.color).toBe("#ff0000");
    // Lines in the gaps have no ticks to size.
    choose("Style", "Lines in the gaps");
    expect(screen.queryByRole("textbox", { name: "Tick length" })).toBeNull();
  });

  it("sets the bleed, its source, and caps it at 5 mm", () => {
    render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Bleed" }));
    expect(screen.queryByText("Taken from")).toBeNull();
    typeNumber(screen.getByRole("textbox", { name: "Bleed" }), "2");
    expect(print().finish.bleed.mm).toBe(2);
    fireEvent.click(screen.getByRole("radio", { name: "The source gap" }));
    expect(print().finish.bleed.source).toBe("source");
    typeNumber(screen.getByRole("textbox", { name: "Bleed" }), "20");
    expect(print().finish.bleed.mm).toBe(5);
  });

  it("switches duplex on, sets the flip and the offsets, and keeps a common back", () => {
    render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Duplex" }));
    expect(screen.queryByText("Common back")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /Print backs/ }));
    expect(print().finish.duplex.on).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Short edge" }));
    expect(print().finish.duplex.flip).toBe("short");
    typeNumber(screen.getByRole("textbox", { name: "Back offset X" }), "-1.5");
    typeNumber(screen.getByRole("textbox", { name: "Back offset Y" }), "99");
    expect(print().finish.duplex.offsetXMm).toBe(-1.5);
    expect(print().finish.duplex.offsetYMm).toBe(10);

    const useSelected = screen.getByRole("button", { name: "Use the selected piece as common back" });
    expect(useSelected.hasAttribute("disabled")).toBe(true);
    act(() => print().selectAll([key(cards[3])]));
    fireEvent.click(useSelected);
    expect(print().finish.duplex.commonBack).toBe(key(cards[3]));
    expect(screen.getByTestId("common-back")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(print().finish.duplex.commonBack).toBeNull();
    expect(screen.getByTestId("common-back-none")).toBeTruthy();
  });

  it("shows the warnings the plan has next to the section they belong to", () => {
    print().setSheets([{ ...sheet(2), warnings: ["bleed_off_page", "marks_off_page"] }], null);
    render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Bleed" }));
    expect(screen.getByText(/The bleed goes past the edge of the page/)).toBeTruthy();
    expect(screen.queryByText(/Some cut marks fall outside/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cut marks" }));
    expect(screen.getByText(/Some cut marks fall outside/)).toBeTruthy();
  });
});

describe("a back for the selected pieces", () => {
  it("is picked by clicking a piece in the library, shown, and cleared", () => {
    render(
      <>
        <CardLibrary />
        <PrintInspector />
      </>,
    );
    const thumb = (c: Card) => document.querySelector(`[data-card="${key(c)}"]`) as HTMLElement;
    fireEvent.click(thumb(cards[0]));
    expect(within(screen.getByTestId("back-summary")).getByText("none")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick back…" }));
    expect(screen.getByTestId("picking-back")).toBeTruthy();
    fireEvent.click(thumb(cards[3]));
    expect(layout().cardEdits.backs).toEqual({ [key(cards[0])]: key(cards[3]) });
    expect(print().pickingBack).toBe(false);
    expect(screen.queryByTestId("picking-back")).toBeNull();
    // The picked piece is not selected by that click; the selection still says what its back is.
    expect(within(screen.getByTestId("back-summary")).getByText("p1 · r2 c2")).toBeTruthy();
    expect(thumb(cards[0]).querySelector("[data-testid=back-badge]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove back" }));
    expect(layout().cardEdits.backs).toEqual({});
  });

  it("is dropped by Esc, and the common back is told apart from a piece's own", () => {
    act(() => print().setDuplex({ on: true, commonBack: key(cards[2]) }));
    render(
      <>
        <CardLibrary />
        <PrintInspector />
      </>,
    );
    const thumb = (c: Card) => document.querySelector(`[data-card="${key(c)}"]`) as HTMLElement;
    expect(thumb(cards[2]).querySelector("[data-testid=back-badge]")?.textContent).toBe("Common back");
    fireEvent.click(thumb(cards[1]));
    expect(within(screen.getByTestId("back-summary")).getByText("common back")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick back…" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(print().pickingBack).toBe(false);
    expect(layout().cardEdits.backs).toEqual({});
  });
});

function sheet(n: number): OutputSheet {
  return {
    page: A4,
    placements: Array.from({ length: n }, (_, i) => ({
      card_id: cards[i % cards.length].id,
      source: cards[0].source,
      destination: { x: 60 * i + 30, y: 40, width: 50, height: 70 },
      turn: 0,
      scale: 1,
    })),
  };
}

function prefsOpen(id: string): boolean | undefined {
  return usePreferencesStore.getState().prefs.inspector.sections[id];
}

describe("Sheet preview with finishing", () => {
  it("draws the cut marks and a frame for the bleed as the engine placed them", async () => {
    print().setSheets(
      [
        {
          ...sheet(2),
          bleed: { mm: 2, source: "mirror" },
          marks: {
            width_pt: 0.7,
            color: [255, 0, 0],
            lines: [
              [20, 10, 20, 20],
              [80, 10, 80, 20],
              [20, 200, 20, 210],
            ],
          },
        },
      ],
      null,
    );
    render(<SheetPreview />);
    await act(async () => {});
    const page = within(screen.getByTestId("sheet-page"));
    expect(page.getAllByTestId("cut-mark")).toHaveLength(3);
    expect(page.getAllByTestId("bleed-frame")).toHaveLength(2);
    expect(page.getAllByTestId("cut-mark")[0].getAttribute("stroke")).toBe("rgb(255,0,0)");
  });

  it("draws nothing extra when there are no marks and no bleed", async () => {
    print().setSheets([sheet(2)], null);
    render(<SheetPreview />);
    await act(async () => {});
    expect(screen.queryByTestId("sheet-overlay")).toBeNull();
    expect(screen.getByText("Sheet 1 of 1")).toBeTruthy();
  });

  it("says front or back for each sheet of a duplex plan and lists the warnings of the one shown", async () => {
    print().setSheets(
      [
        { ...sheet(2), side: "front" },
        { ...sheet(2), side: "back", warnings: ["back_size_differs"] },
      ],
      null,
    );
    render(<SheetPreview />);
    await act(async () => {});
    expect(screen.getByText("Sheet 1 of 2 · front")).toBeTruthy();
    expect(screen.queryByTestId("sheet-warnings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next sheet" }));
    expect(screen.getByText("Sheet 2 of 2 · back")).toBeTruthy();
    expect(within(screen.getByTestId("sheet-warnings")).getByText(/A back is not the same size/)).toBeTruthy();
    const tags = screen.getAllByTestId("sheet-thumb").map((t) => t.textContent);
    expect(tags).toEqual(["1 · front", "2 · back"]);
  });

  it("does not tag sheets when duplex is off", async () => {
    print().setSheets([{ ...sheet(1), side: "front" }], null);
    render(<SheetPreview />);
    await act(async () => {});
    expect(screen.getByText("Sheet 1 of 1")).toBeTruthy();
    expect(screen.getAllByTestId("sheet-thumb").map((t) => t.textContent)).toEqual(["1"]);
  });
});
