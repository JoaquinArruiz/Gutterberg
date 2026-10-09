// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardIdKey, gridCardId } from "../../lib/card";
import { defaultGroups, updateGridGroup } from "../../lib/document-layout";
import type { Card, OutputSheet } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";
import { ApplyGridDialog } from "../sidebar/ApplyGridDialog";
import { EditorToolbar } from "../toolbar/EditorToolbar";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { CardLibrary } from "./CardLibrary";
import { PrintInspector } from "./PrintInspector";
import { SheetPreview } from "./SheetPreview";

// Card images come from the Rust renderer; here every request just resolves.
vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderRegion: vi.fn(async () => "blob:card"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const card = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const key = (c: Card) => cardIdKey(c.id);
const print = () => usePrintStore.getState();

/** Types `value` into a number field and presses Enter, as a user would (focus first: Enter commits by blurring). */
function typeNumber(input: HTMLElement, value: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** A pane of this size, for the components that measure themselves. */
function stubResizeObserver(width: number, height: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width, height } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

beforeEach(() => {
  stubResizeObserver(400, 500);
  usePreferencesStore.getState().resetToDefaults();
  usePrintStore.getState().reset();
  useUiStore.setState({ stage: "cards" });
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(2);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("collapsible sections", () => {
  const section = (
    <CollapsibleSection id="t.one" title="One">
      <p>inside</p>
    </CollapsibleSection>
  );

  it("folds and unfolds on click", () => {
    render(section);
    expect(screen.getByText("inside")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(screen.queryByText("inside")).toBeNull();
    expect(screen.getByRole("button", { name: /One/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /One/ }));
    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("is still folded when it is shown again", () => {
    const first = render(section);
    fireEvent.click(screen.getByRole("button", { name: /One/ }));
    first.unmount();
    render(section);
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("starts closed when told to", () => {
    render(
      <CollapsibleSection id="t.two" title="Two" defaultOpen={false}>
        <p>later</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText("later")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Two/ }));
    expect(screen.getByText("later")).toBeTruthy();
  });
});

describe("Print inspector", () => {
  it("opens Plan and Sheet and folds Page, and each folds on click", () => {
    render(<PrintInspector />);
    expect(screen.getByText("All pieces in order")).toBeTruthy();
    expect(screen.getByText("Group pieces by size")).toBeTruthy();
    expect(screen.queryByText("Margin top")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Page$/ }));
    expect(screen.getByText("Margin top")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Plan$/ }));
    expect(screen.queryByText("All pieces in order")).toBeNull();
    expect(screen.getByText("Group pieces by size")).toBeTruthy();
  });

  it("remembers which sections are open across a restart of the view", () => {
    const first = render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: /^Page$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Sheet$/ }));
    first.unmount();
    render(<PrintInspector />);
    expect(screen.getByText("Margin top")).toBeTruthy();
    expect(screen.queryByText("Group pieces by size")).toBeNull();
    expect(usePreferencesStore.getState().prefs.inspector.sections).toMatchObject({
      "print.page": true,
      "print.sheet": false,
    });
  });

  it("switches the plan and its options", () => {
    render(<PrintInspector />);
    // The order only matters once the sheet grid is not the source's.
    expect(screen.getByRole("radio", { name: /Interleaved/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Custom selection/ }));
    expect(print().mode).toBe("custom");
    expect(screen.getByRole("radio", { name: /Interleaved/ }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /Interleaved/ }));
    expect(print().order).toBe("interleaved");
    fireEvent.click(screen.getByRole("switch", { name: /Auto-fill/ }));
    expect(print().autoFill).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /Group pieces by size/ }));
    expect(print().groupBySize).toBe(false);
  });

  it("starts a custom selection from one of every card", () => {
    print().setCards([card(0, 0, 0), card(0, 0, 1)], null);
    fireEvent.click(render(<PrintInspector />).getByRole("radio", { name: /Custom selection/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start from all pieces/ }));
    expect(Object.values(print().quantities)).toEqual([1, 1]);
  });

  it("explains an error that stops the plan, and offers the fixes", () => {
    // As the engine sends it: a code with its values, and the English text as the fallback.
    print().setSheets(null, {
      code: "does_not_fit",
      message: "laid-out cards need 298.0 x 186.2 mm but the output page is only 210.0 x 297.0 mm",
      needed_w_mm: 298,
      needed_h_mm: 186.2,
      page_w_mm: 210,
      page_h_mm: 297,
    });
    render(<PrintInspector />);
    expect(screen.getByRole("alert").textContent).toContain(
      "The laid-out pieces need 298.0 × 186.2 mm but the sheet is only 210.0 × 297.0 mm.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Auto-fit page" }));
    expect(useLayoutStore.getState().pageMode).toBe("fit");
  });
});

describe("Card library", () => {
  const cards = [card(0, 0, 0), card(0, 0, 1), card(0, 0, 2), card(1, 0, 0)];
  const thumbs = () => Array.from(document.querySelectorAll("[data-card]")) as HTMLElement[];

  beforeEach(() => print().setCards(cards, null));

  it("only mounts the cards near the view, however many there are", () => {
    const many = Array.from({ length: 900 }, (_, i) => card(i % 2, Math.floor(i / 30), i % 30));
    print().setCards(many, null);
    render(<CardLibrary />);
    expect(thumbs().length).toBeGreaterThan(0);
    expect(thumbs().length).toBeLessThan(60);
    expect(screen.getByText("0 of 900 selected")).toBeTruthy();
  });

  it("scrolling mounts the next rows", () => {
    print().setCards(
      Array.from({ length: 900 }, (_, i) => card(i % 2, Math.floor(i / 30), i % 30)),
      null,
    );
    render(<CardLibrary />);
    const before = thumbs().map((t) => t.dataset.card);
    fireEvent.scroll(screen.getByTestId("card-library-scroll"), { target: { scrollTop: 20000 } });
    const after = thumbs().map((t) => t.dataset.card);
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((k) => before.includes(k))).toBe(false);
  });

  it("selects with a click, Ctrl and Shift", () => {
    render(<CardLibrary />);
    const [a, b, c] = thumbs();
    fireEvent.click(a);
    expect(print().selection.selected).toEqual([key(cards[0])]);
    fireEvent.click(c, { ctrlKey: true });
    expect(print().selection.selected).toEqual([key(cards[0]), key(cards[2])]);
    fireEvent.click(a);
    fireEvent.click(c, { shiftKey: true });
    expect(print().selection.selected).toEqual(cards.slice(0, 3).map(key));
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(print().selection.selected).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(print().selection.selected).toHaveLength(4);
  });

  it("prints 9 copies of one card: select it, set the copies, and only it is printed", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    typeNumber(screen.getByRole("textbox", { name: "Copies of the selected pieces" }), "9");
    expect(print().mode).toBe("custom");
    expect(print().quantities).toEqual({ [key(cards[0])]: 9 });
    expect(within(thumbs()[0]).getByText("×9")).toBeTruthy();
  });

  it("chooses three cards and gives them copies with the steppers", () => {
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(thumbs()[2], { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "One copy more" }));
    expect(print().quantities).toEqual(Object.fromEntries(cards.slice(0, 3).map((c) => [key(c), 1])));
    fireEvent.click(screen.getByRole("button", { name: "One copy more" }));
    fireEvent.click(screen.getByRole("button", { name: "One copy fewer" }));
    expect(Object.values(print().quantities)).toEqual([1, 1, 1]);
  });

  it("sets different copies per card (4, 2 and 3)", () => {
    render(<CardLibrary />);
    for (const [i, n] of [4, 2, 3].entries()) {
      fireEvent.click(thumbs()[i]);
      typeNumber(screen.getByRole("textbox", { name: "Copies of the selected pieces" }), String(n));
    }
    expect(Object.values(print().quantities)).toEqual([4, 2, 3]);
  });

  it("filters to one page", () => {
    render(<CardLibrary />);
    typeNumber(screen.getByRole("textbox", { name: "Show only page" }), "2");
    expect(thumbs().map((t) => t.dataset.card)).toEqual([key(cards[3])]);
    expect(screen.getByText("0 of 1 selected")).toBeTruthy();
  });

  it("filters to a group", () => {
    useLayoutStore.setState({
      groups: updateGridGroup(defaultGroups(2), 0, (g) => ({ ...g, selection: { x: 0, y: 0, width: 1, height: 1 } })),
    });
    print().setFilter({ kind: "group", document: 0, index: 0 });
    render(<CardLibrary />);
    expect(thumbs()).toHaveLength(4);
  });

  it("says what to do when there are no cards, and shows an engine error", () => {
    print().setCards([], null);
    const r = render(<CardLibrary />);
    expect(screen.getByText(/No pieces yet/)).toBeTruthy();
    act(() => print().setCards([], "page 3 does not exist"));
    expect(screen.getByText("page 3 does not exist")).toBeTruthy();
    r.unmount();
    useDocumentStore.getState().clear();
    render(<CardLibrary />);
    expect(screen.getByText(/Open a PDF/)).toBeTruthy();
  });

  it("loads each visible card's image from the renderer", async () => {
    render(<CardLibrary />);
    await act(async () => {});
    expect(document.querySelectorAll("img").length).toBe(4);
  });
});

describe("Sheet preview", () => {
  const sheet = (n: number): OutputSheet => ({
    page: A4,
    placements: Array.from({ length: n }, (_, i) => ({
      card_id: gridCardId(0, 0, 0, i),
      source: card(0, 0, 0).source,
      destination: { x: 60 * i, y: 10, width: 50, height: 70 },
      turn: i === 1 ? 90 : 0,
      scale: 1,
    })),
  });

  it("summarises the sheets, shows the page and steps through them", async () => {
    print().setSheets([sheet(9), sheet(2)], null);
    render(<SheetPreview />);
    await act(async () => {});
    expect(screen.getByText("Sheet 1 of 2")).toBeTruthy();
    expect(screen.getByTestId("sheet-summary").textContent).toBe("2 sheets, 11 pieces");
    expect(screen.getByTestId("sheet-page").children).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Next sheet" }));
    expect(screen.getByText("Sheet 2 of 2")).toBeTruthy();
    expect(screen.getByTestId("sheet-page").children).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Next sheet" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous sheet" }));
    expect(screen.getByText("Sheet 1 of 2")).toBeTruthy();
  });

  it("turns a card by the placement's turn", async () => {
    print().setSheets([sheet(2)], null);
    render(<SheetPreview />);
    await act(async () => {});
    const imgs = Array.from(screen.getByTestId("sheet-page").querySelectorAll("img"));
    // The turn is on the card layer around the picture, which is also rotated back by the source angle.
    expect(imgs.map((i) => i.parentElement?.style.transform)).toEqual([
      "translate(-50%, -50%) rotate(0deg)",
      "translate(-50%, -50%) rotate(90deg)",
    ]);
  });

  it("says when nothing is planned, and shows an engine error", () => {
    print().setSheets([], null);
    const r = render(<SheetPreview />);
    expect(screen.getByText(/Nothing to print yet/)).toBeTruthy();
    r.unmount();
    print().setSheets(null, "pieces do not fit");
    render(<SheetPreview />);
    expect(screen.getByText(/pieces do not fit/)).toBeTruthy();
  });
});

describe("stage switch", () => {
  it("shows Cards and Print tabs, and switches between them", () => {
    render(<EditorToolbar />);
    const tabs = screen.getByRole("tablist", { name: "Stage" });
    expect(within(tabs).getByRole("tab", { name: "Source" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTitle(/Zoom in/)).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Print" }));
    expect(useUiStore.getState().stage).toBe("print");
    // The page editor's tools and views do not apply to the Print stage.
    expect(screen.queryByTitle(/Zoom in/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "View" })).toBeNull();
    expect(screen.getByRole("button", { name: /Export PDF/ })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Source" }));
    expect(useUiStore.getState().stage).toBe("cards");
    expect(screen.getByTitle(/Zoom in/)).toBeTruthy();
  });

  it("has no stages to switch to without a document", () => {
    useDocumentStore.getState().clear();
    render(<EditorToolbar />);
    expect(screen.getByRole("tab", { name: "Print" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("compact number fields", () => {
  const isScreenReaderOnly = (text: string) => screen.getByText(text).className.includes("sr-only");

  it("keep long names out of the layout in the library header, with one pair of steppers", () => {
    print().setCards([card(0, 0, 0)], null);
    render(<CardLibrary />);
    expect(isScreenReaderOnly("Copies of the selected pieces")).toBe(true);
    expect(isScreenReaderOnly("Show only page")).toBe(true);
    // The copies field is stepped by the library's own buttons; the field adds none of its own.
    expect(screen.queryByRole("button", { name: /Increase Copies/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Decrease Copies/ })).toBeNull();
    expect(screen.getByRole("button", { name: "One copy more" })).toBeTruthy();
    // The page filter keeps its own -/+.
    expect(screen.getByRole("button", { name: "Increase Show only page" })).toBeTruthy();
  });
});

describe("Apply this grid to…", () => {
  beforeEach(() => {
    // jsdom has no <dialog> modal support; opening it just marks it open.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4, A4, A4], hash: "" }], 0);
    useLayoutStore.getState().resetDocument(4);
    useLayoutStore.getState().setSelection(0, { x: 0, y: 0, width: 1, height: 1 });
  });

  const ranges = () => useLayoutStore.getState().groups.map((g) => `${g.kind}:${g.pages.first}-${g.pages.last}`);

  it("shows the page range fields on one row, without their long names", () => {
    render(<ApplyGridDialog open onClose={() => {}} />);
    const from = screen.getByRole("textbox", { name: "From page" });
    const to = screen.getByRole("textbox", { name: "To page" });
    expect(screen.getByText("From page").className).toContain("sr-only");
    expect(screen.getByText("To page").className).toContain("sr-only");
    expect(from.closest("div")).toBe(to.closest("div"));
    expect(screen.getByRole("radio", { name: "Pages" })).toBeTruthy();
  });

  it("copies the grid to a range of pages", () => {
    const onClose = vi.fn();
    render(<ApplyGridDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pages" }));
    typeNumber(screen.getByRole("textbox", { name: "From page" }), "3");
    typeNumber(screen.getByRole("textbox", { name: "To page" }), "4");
    expect(screen.getByText("Pages 3–4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(ranges()).toEqual(["grid:0-1", "grid:2-3"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("detaches only the viewed page", () => {
    render(<ApplyGridDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Only this page/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(ranges()).toEqual(["grid:0-0", "grid:1-3"]);
  });

  it("applies to every page of the same size by default", () => {
    render(<ApplyGridDialog open onClose={() => {}} />);
    expect(screen.getByText("Pages 1–4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(ranges()).toEqual(["grid:0-3"]);
  });
});

describe("sheet previews strip", () => {
  const sheet = (n: number): OutputSheet => ({
    page: A4,
    placements: Array.from({ length: n }, (_, i) => ({
      card_id: gridCardId(0, 0, 0, i),
      source: card(0, 0, 0).source,
      destination: { x: 60 * i, y: 10, width: 50, height: 70 },
      turn: 0,
      scale: 1,
    })),
  });
  const thumbs = () => screen.queryAllByTestId("sheet-thumb");

  describe("with Live Preview on", () => {
    beforeEach(() => useLayoutStore.setState({ live: true }));

    it("shows every sheet as a small preview and selects one on click", () => {
      print().setSheets([sheet(9), sheet(4), sheet(1)], null);
      render(<SheetPreview />);
      expect(thumbs()).toHaveLength(3);
      expect(thumbs()[0].getAttribute("aria-current")).toBe("true");
      fireEvent.click(thumbs()[1]);
      expect(print().currentSheet).toBe(1);
      expect(screen.getByText("Sheet 2 of 3")).toBeTruthy();
      expect(thumbs()[1].getAttribute("aria-current")).toBe("true");
      expect(screen.getByTestId("sheet-page").children).toHaveLength(4);
    });

    it("draws the cards of each sheet in its preview", async () => {
      print().setSheets([sheet(3)], null);
      render(<SheetPreview />);
      await act(async () => {});
      expect(within(thumbs()[0]).getAllByRole("presentation", { hidden: true }).length).toBe(3);
    });

    it("follows the plan as it changes", () => {
      print().setSheets([sheet(9), sheet(4)], null);
      render(<SheetPreview />);
      expect(thumbs()).toHaveLength(2);
      act(() => print().setSheets([sheet(9), sheet(9), sheet(2)], null));
      expect(thumbs()).toHaveLength(3);
      expect(screen.getByText("Sheet 1 of 3")).toBeTruthy();
      act(() => print().setSheets([sheet(1)], null));
      expect(thumbs()).toHaveLength(1);
    });

    it("has no refresh button, tip or out-of-date mark", () => {
      print().setSheets([sheet(2)], null);
      render(<SheetPreview />);
      act(() => print().setSheets([sheet(3)], null));
      expect(screen.queryByRole("button", { name: /Refresh preview/ })).toBeNull();
      expect(screen.queryByTestId("hint-live-preview-sheets")).toBeNull();
      expect(screen.queryByText("Preview out of date")).toBeNull();
    });

    it("hides and shows the strip with the arrow, and remembers it", () => {
      print().setSheets([sheet(2), sheet(2)], null);
      const first = render(<SheetPreview />);
      const arrow = screen.getByRole("button", { name: "Hide sheet previews" });
      expect(arrow.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(arrow);
      expect(screen.queryByTestId("sheet-strip")).toBeNull();
      expect(screen.getByRole("button", { name: "Show sheet previews" }).getAttribute("aria-expanded")).toBe("false");
      // The sheet itself and its navigation stay.
      expect(screen.getByText("Sheet 1 of 2")).toBeTruthy();
      expect(screen.getByTestId("sheet-page")).toBeTruthy();
      first.unmount();
      render(<SheetPreview />);
      expect(screen.queryByTestId("sheet-strip")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show sheet previews" }));
      expect(thumbs()).toHaveLength(2);
    });

    it("has no strip when there is nothing to show", () => {
      print().setSheets([], null);
      render(<SheetPreview />);
      expect(screen.queryByTestId("sheet-strip")).toBeNull();
    });

    it("says it is planning until the first plan arrives", () => {
      render(<SheetPreview />);
      expect(screen.getByText(/Planning the sheets/)).toBeTruthy();
    });
  });

  describe("with Live Preview off", () => {
    beforeEach(() => useLayoutStore.setState({ live: false }));

    it("shows the first plan at once, with the tip and a refresh button", () => {
      print().setSheets([sheet(9), sheet(2)], null);
      render(<SheetPreview />);
      expect(thumbs()).toHaveLength(2);
      expect(screen.getByTestId("hint-live-preview-sheets")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Refresh preview/ })).toBeTruthy();
      expect(screen.queryByText("Preview out of date")).toBeNull();
    });

    it("redraws the large sheet at once, and only the row of previews waits for a refresh", () => {
      print().setSheets([sheet(9), sheet(2)], null);
      render(<SheetPreview />);
      expect(screen.getByTestId("sheet-page").children).toHaveLength(9);

      // Copies change: the sheet in front and its numbers follow the plan immediately...
      act(() => print().setSheets([sheet(4), sheet(9), sheet(9)], null));
      expect(screen.getByTestId("sheet-page").children).toHaveLength(4);
      expect(screen.getByText("Sheet 1 of 3")).toBeTruthy();
      expect(screen.getByTestId("sheet-summary").textContent).toBe("3 sheets, 22 pieces");
      // ...while the previews above still show the sheets as they were, and say so.
      expect(thumbs()).toHaveLength(2);
      expect(screen.getByText("Previews out of date")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Refresh preview" }).getAttribute("title")).toContain("out of date");

      fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
      expect(thumbs()).toHaveLength(3);
      expect(screen.queryByText("Previews out of date")).toBeNull();
    });

    it("shows the chosen sheet large straight away, previews or not", () => {
      print().setSheets([sheet(9), sheet(2), sheet(5)], null);
      render(<SheetPreview />);
      act(() => print().setSheets([sheet(9), sheet(2), sheet(5)], null)); // a new plan, previews not refreshed
      fireEvent.click(thumbs()[2]);
      expect(screen.getByText("Sheet 3 of 3")).toBeTruthy();
      expect(screen.getByTestId("sheet-page").children).toHaveLength(5);
      fireEvent.click(screen.getByRole("button", { name: "Previous sheet" }));
      expect(screen.getByTestId("sheet-page").children).toHaveLength(2);
      expect(thumbs()[1].getAttribute("aria-current")).toBe("true");
    });

    it("keeps the sheet in front valid when the plan shrinks under frozen previews", () => {
      print().setSheets([sheet(2), sheet(2), sheet(2)], null);
      render(<SheetPreview />);
      fireEvent.click(thumbs()[2]);
      act(() => print().setSheets([sheet(3)], null));
      expect(screen.getByText("Sheet 1 of 1")).toBeTruthy();
      expect(screen.getByTestId("sheet-page").children).toHaveLength(3);
      expect(thumbs()).toHaveLength(3); // the frozen row, until refreshed
    });

    it("needs no tip or refresh button when the previews are hidden", () => {
      print().setSheets([sheet(2)], null);
      render(<SheetPreview />);
      fireEvent.click(screen.getByRole("button", { name: "Hide sheet previews" }));
      expect(screen.queryByTestId("hint-live-preview-sheets")).toBeNull();
      expect(screen.queryByRole("button", { name: "Refresh preview" })).toBeNull();
      act(() => print().setSheets([sheet(5)], null));
      expect(screen.getByTestId("sheet-page").children).toHaveLength(5);
      fireEvent.click(screen.getByRole("button", { name: "Show sheet previews" }));
      expect(screen.getByTestId("hint-live-preview-sheets")).toBeTruthy();
    });

    it("lets the tip be closed for good, keeping the refresh button", () => {
      print().setSheets([sheet(2)], null);
      render(<SheetPreview />);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
      expect(screen.queryByTestId("hint-live-preview-sheets")).toBeNull();
      expect(screen.getByRole("button", { name: /Refresh preview/ })).toBeTruthy();
      expect(usePreferencesStore.getState().prefs.help.dismissedHints).toEqual({ "live-preview-sheets": 1 });
    });

    it("waits for the first plan, then shows it without a click", () => {
      render(<SheetPreview />);
      expect(screen.getByText(/Planning the sheets/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Refresh preview/ }).hasAttribute("disabled")).toBe(true);
      act(() => print().setSheets([sheet(2)], null));
      expect(thumbs()).toHaveLength(1);
    });

    it("starts again from a fresh plan whenever the stage is entered", () => {
      print().setSheets([sheet(2)], null);
      const first = render(<SheetPreview />);
      expect(thumbs()).toHaveLength(1);
      first.unmount();
      act(() => print().beginPlanning());
      render(<SheetPreview />);
      expect(thumbs()).toHaveLength(0);
      expect(screen.getByText(/Planning the sheets/)).toBeTruthy();
    });
  });
});
