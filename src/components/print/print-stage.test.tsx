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
  useDocumentStore.setState({ path: "/x.pdf", pages: [A4, A4], currentPage: 0 });
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
    expect(screen.getByText("All cards in order")).toBeTruthy();
    expect(screen.getByText("Group cards by size")).toBeTruthy();
    expect(screen.queryByText("Margin top")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Page$/ }));
    expect(screen.getByText("Margin top")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Plan$/ }));
    expect(screen.queryByText("All cards in order")).toBeNull();
    expect(screen.getByText("Group cards by size")).toBeTruthy();
  });

  it("remembers which sections are open across a restart of the view", () => {
    const first = render(<PrintInspector />);
    fireEvent.click(screen.getByRole("button", { name: /^Page$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Sheet$/ }));
    first.unmount();
    render(<PrintInspector />);
    expect(screen.getByText("Margin top")).toBeTruthy();
    expect(screen.queryByText("Group cards by size")).toBeNull();
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
    fireEvent.click(screen.getByRole("checkbox", { name: /Auto-fill/ }));
    expect(print().autoFill).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Group cards by size/ }));
    expect(print().groupBySize).toBe(false);
  });

  it("starts a custom selection from one of every card", () => {
    print().setCards([card(0, 0, 0), card(0, 0, 1)], null);
    fireEvent.click(render(<PrintInspector />).getByRole("radio", { name: /Custom selection/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start from all cards/ }));
    expect(Object.values(print().quantities)).toEqual([1, 1]);
  });

  it("explains an error that stops the plan, and offers the fixes", () => {
    print().setSheets(null, "laid-out cards need 298.0 x 186.2 mm but the page is only 210 x 297 mm");
    render(<PrintInspector />);
    expect(screen.getByRole("alert").textContent).toContain("laid-out cards need 298.0");
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
    typeNumber(screen.getByRole("textbox", { name: "Copies of the selected cards" }), "9");
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
      typeNumber(screen.getByRole("textbox", { name: "Copies of the selected cards" }), String(n));
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
    print().setFilter({ kind: "group", index: 0 });
    render(<CardLibrary />);
    expect(thumbs()).toHaveLength(4);
  });

  it("says what to do when there are no cards, and shows an engine error", () => {
    print().setCards([], null);
    const r = render(<CardLibrary />);
    expect(screen.getByText(/No cards yet/)).toBeTruthy();
    act(() => print().setCards([], "page 3 does not exist"));
    expect(screen.getByText("page 3 does not exist")).toBeTruthy();
    r.unmount();
    useDocumentStore.setState({ path: null, pages: [] });
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
    expect(screen.getByTestId("sheet-summary").textContent).toBe("2 sheets, 11 cards");
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
    expect(imgs.map((i) => i.style.transform)).toEqual(["", "rotate(90deg)"]);
  });

  it("says when nothing is planned, and shows an engine error", () => {
    print().setSheets([], null);
    const r = render(<SheetPreview />);
    expect(screen.getByText(/Nothing to print yet/)).toBeTruthy();
    r.unmount();
    print().setSheets(null, "cards do not fit");
    render(<SheetPreview />);
    expect(screen.getByText(/cards do not fit/)).toBeTruthy();
  });
});

describe("stage switch", () => {
  it("shows Cards and Print tabs, and switches between them", () => {
    render(<EditorToolbar />);
    const tabs = screen.getByRole("tablist", { name: "Stage" });
    expect(within(tabs).getByRole("tab", { name: "Cards" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTitle(/Zoom in/)).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Print" }));
    expect(useUiStore.getState().stage).toBe("print");
    // The page editor's tools and views do not apply to the Print stage.
    expect(screen.queryByTitle(/Zoom in/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Workspace" })).toBeNull();
    expect(screen.getByRole("button", { name: /Export PDF/ })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Cards" }));
    expect(useUiStore.getState().stage).toBe("cards");
    expect(screen.getByTitle(/Zoom in/)).toBeTruthy();
  });

  it("has no stages to switch to without a document", () => {
    useDocumentStore.setState({ path: null, pages: [] });
    render(<EditorToolbar />);
    expect(screen.getByRole("tab", { name: "Print" }).hasAttribute("disabled")).toBe(true);
  });
});
