// @vitest-environment jsdom
// The parts of a project with several PDFs that the user sees: the library and sheets mixing pieces of
// both, the switcher in the Source tab, the File menu and the grid presets.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridCardId } from "../lib/card";
import type { Card, OutputSheet } from "../lib/sheet-api";
import { renderRegion } from "../lib/tauri";
import { clearCardImages } from "../lib/use-card-image";
import { fileName, useDocumentStore } from "../stores/document-store";
import { useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { usePrintStore } from "../stores/print-store";
import { useProjectStore } from "../stores/project-store";
import { useUiStore } from "../stores/ui-store";
import { CardLibrary } from "./print/CardLibrary";
import { SheetPreview } from "./print/SheetPreview";
import { PagesPanel } from "./sidebar/PagesPanel";
import { PropertiesSidebar } from "./sidebar/PropertiesSidebar";
import { FileMenu } from "./toolbar/FileMenu";
import { ProjectNotices } from "./toolbar/ProjectNotices";

vi.mock("../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tauri")>()),
  renderRegion: vi.fn(async () => "blob:card"),
  renderPage: vi.fn(async () => "blob:page"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const card = (doc: number, page: number, row: number, column: number): Card => ({
  id: gridCardId(doc, page, row, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const sel = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const print = () => usePrintStore.getState();
const thumbs = () => Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));

/** Two PDFs: "a.pdf" with two pages and "b.pdf" with one, both with a region drawn. */
function twoDocuments() {
  useDocumentStore.getState().setDocuments(
    [
      { id: 0, path: "/games/a.pdf", pages: [A4, A4], hash: "" },
      { id: 1, path: "/games/b.pdf", pages: [A4], hash: "" },
    ],
    0,
  );
  const layout = useLayoutStore.getState();
  layout.resetDocument(2);
  layout.setSelection(0, sel);
  layout.parkDocument(1, {
    groups: [
      {
        kind: "grid",
        pages: { first: 0, last: 0 },
        grid: { rows: 2, columns: 2, sourceGapXMm: 0, sourceGapYMm: 0, sourceGapLinked: true },
        selection: sel,
      },
    ],
    freeform: {},
  });
}

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
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  usePreferencesStore.getState().resetToDefaults();
  // Presets and recent projects are the user's own data, so resetting the preferences keeps them.
  for (const p of usePreferencesStore.getState().prefs.presets) usePreferencesStore.getState().deletePreset(p.name);
  for (const p of usePreferencesStore.getState().prefs.files.recent)
    usePreferencesStore.getState().removeRecentProject(p);
  print().reset();
  clearCardImages();
  // jsdom has no layout: scrolling a list item into view is a no-op there.
  Element.prototype.scrollIntoView = vi.fn();
  useUiStore.setState({ stage: "print" });
  useProjectStore.getState().clearNotices();
  vi.mocked(renderRegion).mockClear();
  twoDocuments();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the piece library with two PDFs", () => {
  const cards = [card(0, 0, 0, 0), card(0, 1, 0, 0), card(1, 0, 0, 0), card(1, 0, 0, 1)];

  it("shows the pieces of both, each cut from its own PDF", async () => {
    print().setCards(cards, null);
    render(<CardLibrary />);
    await act(async () => {});
    expect(thumbs().map((t) => t.dataset.card)).toEqual(["g:0:0:0:0", "g:0:1:0:0", "g:1:0:0:0", "g:1:0:0:1"]);
    // Page 0 of document 1 is a different page than page 0 of document 0.
    const asked = vi.mocked(renderRegion).mock.calls.map(([, doc, page]) => [doc, page]);
    expect(asked).toContainEqual([1, 0]);
    expect(asked).toContainEqual([0, 1]);
  });

  it("filters to one PDF, and to the groups of that PDF", () => {
    print().setCards(cards, null);
    print().setFilter({ kind: "document", document: 1 });
    render(<CardLibrary />);
    expect(thumbs().map((t) => t.dataset.card)).toEqual(["g:1:0:0:0", "g:1:0:0:1"]);
    act(() => print().setFilter({ kind: "group", document: 0, index: 0 }));
    expect(thumbs().map((t) => t.dataset.card)).toEqual(["g:0:0:0:0", "g:0:1:0:0"]);
  });

  it("offers each PDF in the filter menu, with its groups named after it", () => {
    print().setCards(cards, null);
    render(<CardLibrary />);
    fireEvent.click(screen.getByRole("combobox", { name: "Filter pieces by group" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "All pieces",
      "All pieces of a.pdf",
      "All pieces of b.pdf",
      "a.pdf: Pages 1–2 (3×3)",
      "b.pdf: Page 1 (2×2)",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "All pieces of b.pdf" }));
    expect(print().filter).toEqual({ kind: "document", document: 1 });
  });

  it("keeps the old menu when there is only one PDF", () => {
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/games/a.pdf", pages: [A4, A4], hash: "" }], 0);
    useLayoutStore.getState().resetDocument(2);
    useLayoutStore.getState().setSelection(0, sel);
    render(<CardLibrary />);
    fireEvent.click(screen.getByRole("combobox", { name: "Filter pieces by group" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All pieces", "Pages 1–2 (3×3)"]);
  });

  it("selects pieces of different PDFs together and gives them copies", () => {
    print().setCards(cards, null);
    render(<CardLibrary />);
    fireEvent.click(thumbs()[0]);
    fireEvent.click(thumbs()[2], { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "One copy more" }));
    expect(print().quantities).toEqual({ "g:0:0:0:0": 1, "g:1:0:0:0": 1 });
  });
});

describe("a sheet with pieces of two PDFs", () => {
  it("cuts each piece from its own PDF", async () => {
    const sheet: OutputSheet = {
      page: A4,
      placements: [card(0, 1, 0, 0), card(1, 0, 0, 1)].map((c, i) => ({
        card_id: c.id,
        source: c.source,
        destination: { x: 60 * i, y: 10, width: 50, height: 70 },
        turn: 0,
        scale: 1,
      })),
    };
    useLayoutStore.setState({ live: true });
    print().setSheets([sheet], null);
    render(<SheetPreview />);
    await act(async () => {});
    const asked = vi.mocked(renderRegion).mock.calls.map(([, doc, page]) => [doc, page]);
    expect(asked).toContainEqual([0, 1]);
    expect(asked).toContainEqual([1, 0]);
  });
});

describe("the Source tab with two PDFs", () => {
  beforeEach(() => useUiStore.setState({ stage: "cards" }));

  it("switches the PDF being edited from the page panel", () => {
    render(<PagesPanel orientation="vertical" />);
    expect(document.querySelectorAll("[data-testid=pages-list] > div")).toHaveLength(2);
    fireEvent.click(screen.getByRole("combobox", { name: "PDF being edited" }));
    fireEvent.click(screen.getByRole("option", { name: "b.pdf" }));
    expect(useDocumentStore.getState().activeId).toBe(1);
    expect(document.querySelectorAll("[data-testid=pages-list] > div")).toHaveLength(1);
  });

  it("has no switcher with one PDF, but still lets another be added", () => {
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/games/a.pdf", pages: [A4], hash: "" }], 0);
    useLayoutStore.getState().resetDocument(1);
    render(<PagesPanel orientation="vertical" />);
    expect(screen.queryByRole("combobox", { name: "PDF being edited" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add PDF…" })).toBeTruthy();
  });
});

describe("the File menu", () => {
  it("offers the project actions, and the recent projects by name", () => {
    usePreferencesStore.getState().addRecentProject("/projects/poker night.gtr");
    render(<FileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual([
      "New projectCtrl+N",
      "Open PDF…Ctrl+O",
      "Open project…Ctrl+Shift+O",
      "Add PDF…",
      "Add images…",
      "SaveCtrl+S",
      "Save as…Ctrl+Shift+S",
      "poker night.gtr",
      "Keyboard shortcuts…?",
    ]);
    expect(screen.getByRole("menuitem", { name: "poker night.gtr" }).getAttribute("title")).toBe(
      "/projects/poker night.gtr",
    );
  });

  it("opens the keyboard shortcuts sheet, even with nothing open", () => {
    useDocumentStore.getState().clear();
    useUiStore.setState({ shortcutsOpen: false });
    render(<FileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    const item = screen.getByRole("menuitem", { name: /Keyboard shortcuts/ });
    expect(item.hasAttribute("disabled")).toBe(false);
    fireEvent.click(item);
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
  });

  it("says when there are no recent projects, and disables saving with no PDF open", () => {
    useDocumentStore.getState().clear();
    render(<FileMenu />);
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByText("No recent projects")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^SaveCtrl/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Add PDF/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /New project/ }).hasAttribute("disabled")).toBe(false);
  });
});

describe("project messages", () => {
  it("word an engine error in the current language and close on their own", () => {
    useProjectStore.getState().addError({ code: "not_a_project", message: "x", values: {} });
    useProjectStore.getState().addError({ code: "project_too_new", message: "x", values: { found: 3, supported: 1 } });
    useProjectStore.getState().addNotice("pdfChanged", { name: "a.pdf" });
    render(<ProjectNotices />);
    expect(screen.getByText("This is not a valid project file.")).toBeTruthy();
    expect(screen.getByText(/made with a newer version of the app .* Please update\./)).toBeTruthy();
    expect(screen.getByText(/“a\.pdf” has changed since the project was saved/)).toBeTruthy();
    const first = screen.getAllByRole("button", { name: "Close" })[0];
    fireEvent.click(first);
    expect(screen.queryByText("This is not a valid project file.")).toBeNull();
    expect(useProjectStore.getState().notices).toHaveLength(2);
  });
});

describe("grid presets", () => {
  const preset = {
    name: "3×3 poker, 0 mm",
    rows: 3,
    columns: 3,
    sourceGapXMm: 0,
    sourceGapYMm: 0,
    sourceGapLinked: true,
  };

  const openSection = () => {
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
  };

  it("saves the viewed group's grid under a name and applies it to another group", () => {
    render(<PropertiesSidebar />);
    // Make a 2 × 4 grid with a 1.5 mm gap on the viewed page, and save it.
    const store = useLayoutStore.getState();
    act(() => {
      store.setGrid(0, { rows: 2, columns: 4, sourceGapXMm: 1.5 });
    });
    openSection();
    fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: "Tarot" } });
    fireEvent.click(screen.getByRole("button", { name: "Save current grid" }));
    expect(usePreferencesStore.getState().prefs.presets).toEqual([
      { name: "Tarot", rows: 2, columns: 4, sourceGapXMm: 1.5, sourceGapYMm: 1.5, sourceGapLinked: true },
    ]);

    // Another page group gets the preset's grid and gap.
    act(() => {
      store.applyGrid(0, [1]);
      store.setGrid(1, { rows: 1, columns: 1, sourceGapXMm: 0 });
      useDocumentStore.getState().setCurrentPage(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply to this page group" }));
    const second = useLayoutStore.getState().groups[1];
    expect(second.kind === "grid" && second.grid).toMatchObject({ rows: 2, columns: 4, sourceGapXMm: 1.5 });
    const first = useLayoutStore.getState().groups[0];
    expect(first.kind === "grid" && first.grid).toMatchObject({ rows: 2, columns: 4 });
  });

  it("offers a name made from the grid when none is typed, and deletes a preset", () => {
    render(<PropertiesSidebar />);
    openSection();
    fireEvent.click(screen.getByRole("button", { name: "Save current grid" }));
    expect(usePreferencesStore.getState().prefs.presets.map((p) => p.name)).toEqual(["3×3, 0.0 mm"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete preset" }));
    expect(usePreferencesStore.getState().prefs.presets).toEqual([]);
    expect(screen.getByText(/No presets yet/)).toBeTruthy();
  });

  it("applies a preset saved earlier, in any project", () => {
    usePreferencesStore.getState().savePreset(preset);
    render(<PropertiesSidebar />);
    openSection();
    const before = useLayoutStore.getState().groups[0];
    expect(before.kind === "grid" && before.grid.rows).toBe(3);
    act(() => useLayoutStore.getState().setGrid(0, { rows: 5, columns: 6, sourceGapXMm: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to this page group" }));
    const after = useLayoutStore.getState().groups[0];
    expect(after.kind === "grid" && after.grid).toMatchObject({
      rows: 3,
      columns: 3,
      sourceGapXMm: 0,
      sourceGapYMm: 0,
    });
    expect(within(screen.getByTestId("section-cards.presets")).getByRole("combobox").textContent).toContain(
      preset.name,
    );
  });
});

describe("file names", () => {
  it("are the last part of a path, on any system", () => {
    expect(fileName("/games/a.pdf")).toBe("a.pdf");
    expect(fileName("C:\\games\\b.pdf")).toBe("b.pdf");
    expect(fileName("plain.pdf")).toBe("plain.pdf");
  });
});
