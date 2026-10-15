// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridCardId } from "../../lib/card";
import { documentToScreen, type Point } from "../../lib/coordinates";
import { type GridGroup, gridGroupAt } from "../../lib/document-layout";
import type { Card } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { EditorViewport } from "../editor/EditorViewport";
import { ContextMenuHost } from "../ui/ContextMenu";
import { GridsPanel, NewFolderButton } from "./GridsPanel";
import { TurnIntoPiecesButton } from "./TurnIntoPiecesButton";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
  renderRegion: vi.fn(async () => "blob:crop"),
}));
vi.mock("../../lib/edges-api", () => ({ pageEdges: async () => ({ vertical: [], horizontal: [] }) }));
// The engine's cells: two of the first grid and three of the second, on page 1.
const cards: Card[] = [
  ...[0, 1].map((column) => gridCardId(0, 0, 0, column)),
  ...[0, 1, 2].map((column) => gridCardId(0, 0, 0, column, 1)),
].map((id, i) => ({
  id,
  source: { center: { x: 50 + i * 60, y: 100 }, width: 50, height: 60, angle_deg: 0 },
  scale: 1,
  turn: 0 as const,
}));
vi.mock("../../lib/sheet-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sheet-api")>()),
  computeCards: async () => cards,
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const TOP = { x: 0.1, y: 0.1, width: 0.6, height: 0.3 };
const BOTTOM = { x: 0.1, y: 0.6, width: 0.6, height: 0.2 };
const store = () => useLayoutStore.getState();
const group = () => gridGroupAt(store().groups, 0) as GridGroup;
const at = (p: Point) => {
  const s = documentToScreen(p, useEditorStore.getState().viewport, A4);
  return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1 };
};

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
  Element.prototype.scrollIntoView = vi.fn();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  store().resetDocument(1);
  store().setSelection(0, TOP);
  useEditorStore.setState({ tool: "grid", pickedRegion: null, viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the list of grids", () => {
  it("adds a grid, picked and ready to be drawn with the Grid region tool", () => {
    useEditorStore.setState({ tool: "card" });
    render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Add grid" }));
    expect(group().grids).toHaveLength(2);
    expect(store().activeGrid).toBe(1);
    expect(useEditorStore.getState().tool).toBe("grid");
  });

  it("picks a grid and deletes one", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    const { rerender } = render(<GridsPanel />);
    const first = screen.getByRole("button", { name: /^Grid 1/ });
    fireEvent.click(first);
    expect(store().activeGrid).toBe(0);
    rerender(<GridsPanel />);
    expect(screen.getByRole("button", { name: /^Grid 1/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Delete Grid 1" }));
    expect(group().grids.map((r) => r.selection)).toEqual([BOTTOM]);
  });
});

describe("naming, coloring and folding grids", () => {
  it("renames a grid, gives it a color and puts it in a new folder", () => {
    const { rerender } = render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Name, color and folder of Grid 1" }));
    const name = screen.getByRole("textbox", { name: "Grid name" });
    fireEvent.change(name, { target: { value: "  Poker cards " } });
    fireEvent.blur(name);
    expect(group().grids[0].name).toBe("Poker cards");
    rerender(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    expect(group().grids[0].color).toBe("#ef4444");
    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: "New folder" }));
    expect(group().grids[0].folder).toBe("Folder 1");
    rerender(<GridsPanel />);
    expect(screen.getByRole("button", { name: /^Folder 1/ })).toBeTruthy();
    // Esc leaves a name as it was.
    const again = screen.getByRole("textbox", { name: "Grid name" });
    fireEvent.change(again, { target: { value: "Oops" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(group().grids[0].name).toBe("Poker cards");
  });

  it("picks a folder, renames it and takes its grids out", () => {
    store().addGrid(0);
    store().setGridLook(0, 0, { folder: "Cards" });
    store().setGridLook(0, 1, { folder: "Cards" });
    const { rerender } = render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Cards/ }));
    expect(store().pickedFolder).toBe("Cards");
    expect(useEditorStore.getState().pickedRegion).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Rename Cards" }));
    const field = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(field, { target: { value: "Big" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(group().grids.map((r) => r.folder)).toEqual(["Big", "Big"]);
    expect(store().pickedFolder).toBe("Big");
    rerender(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Take the grids out of Big" }));
    expect(group().grids.map((r) => r.folder)).toEqual([undefined, undefined]);
  });
});

describe("the Grids list, rearranged and hidden", () => {
  it("renames a grid or a folder with a double-click, and colors a grid from its dot", () => {
    store().setGridLook(0, 0, { folder: "Cards" });
    const { rerender } = render(<GridsPanel />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /^Grid 1/ }));
    const field = screen.getByRole("textbox", { name: "Grid name" });
    fireEvent.change(field, { target: { value: "Poker" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(group().grids[0].name).toBe("Poker");
    rerender(<GridsPanel />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /^Cards/ }));
    const folderField = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(folderField, { target: { value: "Big" } });
    fireEvent.blur(folderField);
    expect(group().grids[0].folder).toBe("Big");
    rerender(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Color of Poker" }));
    fireEvent.click(screen.getByRole("button", { name: "Teal" }));
    expect(group().grids[0].color).toBe("#14b8a6");
    rerender(<GridsPanel />);
    expect(screen.queryByRole("button", { name: "Teal" })).toBeNull();
  });

  it("adds an empty folder from the header, ready to be named, and deletes it", () => {
    const { rerender } = render(
      <>
        <NewFolderButton />
        <GridsPanel />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    expect(group().folders).toEqual(["Folder 1"]);
    rerender(<GridsPanel />);
    const field = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(field, { target: { value: "Tokens" } });
    fireEvent.blur(field);
    expect(group().folders).toEqual(["Tokens"]);
    rerender(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Tokens" }));
    expect(group().folders).toBeUndefined();
  });

  it("drags a grid into a folder, which then comes first like the folder did", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    store().addFolder(0, "Cards");
    render(<GridsPanel />);
    const row = (key: string) => document.querySelector<HTMLElement>(`[data-list-item="${key}"]`) as HTMLElement;
    const dragOnto = (from: string, onto: string, share: number) => {
      const target = row(onto);
      target.getBoundingClientRect = () => ({ top: 0, height: 20, left: 0, width: 200 }) as DOMRect;
      document.elementFromPoint = () => target;
      fireEvent.pointerDown(row(from), { button: 0, clientX: 0, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 0, clientY: share * 20 });
      fireEvent.pointerUp(window, { clientX: 0, clientY: share * 20 });
    };
    act(() => dragOnto("g:1", "f:Cards", 0.8));
    expect(group().grids.map((r) => r.folder)).toEqual(["Cards", undefined]);
    expect(group().grids.map((r) => r.selection)).toEqual([BOTTOM, TOP]);
  });

  it("hides a grid on the page with the eye, and the page leaves it alone", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    const { unmount } = render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Grid 2 on the page (it still prints)" }));
    expect(group().grids[1].hidden).toBe(true);
    unmount();
    render(<EditorViewport />);
    await act(async () => {});
    const svg = screen.getByRole("img", { name: "Page canvas" });
    expect(svg.querySelector("[data-hit='body']")).toBeNull();
    // A press on the empty page draws nothing over the hidden grid.
    fireEvent.pointerDown(svg, at({ x: 0.8, y: 0.9 }));
    fireEvent.pointerMove(svg, at({ x: 0.9, y: 0.95 }));
    fireEvent.pointerUp(svg, at({ x: 0.9, y: 0.95 }));
    expect(group().grids[1].selection).toEqual(BOTTOM);
  });
});

describe("several grids on the page", () => {
  it("drags every grid of a picked folder together, and one grid alone once it is picked", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    store().setGridLook(0, 0, { folder: "Cards" });
    store().setGridLook(0, 1, { folder: "Cards" });
    store().pickFolder(0, "Cards");
    useEditorStore.setState({ pickedRegion: 0 });
    render(<EditorViewport />);
    await act(async () => {});
    const svg = screen.getByRole("img", { name: "Page canvas" });
    const other = screen.getByTestId("other-grids").querySelector<SVGRectElement>("[data-hit='other-grid']");
    expect(other?.dataset.grid).toBe("1");
    fireEvent.pointerDown(other as SVGRectElement, at({ x: 0.3, y: 0.7 }));
    fireEvent.pointerMove(svg, at({ x: 0.33, y: 0.65 }));
    fireEvent.pointerUp(svg, at({ x: 0.33, y: 0.65 }));
    const [a, b] = group().grids.map((r) => r.selection);
    expect(a?.x).toBeGreaterThan(TOP.x);
    expect((b?.x ?? 0) - BOTTOM.x).toBeCloseTo((a?.x ?? 0) - TOP.x, 9);
    expect((b?.y ?? 0) - BOTTOM.y).toBeCloseTo((a?.y ?? 0) - TOP.y, 9);
    expect(store().pickedFolder).toBe("Cards");

    // Picked on its own, the second grid moves alone.
    act(() => store().setActiveGrid(1));
    const before = group().grids[0].selection;
    const body = svg.querySelector<SVGRectElement>("[data-hit='body']");
    fireEvent.pointerDown(body as SVGRectElement, at({ x: 0.3, y: 0.62 }));
    fireEvent.pointerMove(svg, at({ x: 0.3, y: 0.66 }));
    fireEvent.pointerUp(svg, at({ x: 0.3, y: 0.66 }));
    expect(group().grids[0].selection).toEqual(before);
    expect(group().grids[1].selection?.y).toBeGreaterThan(b?.y ?? 1);
  });

  it("draws the other grids dimmer, and pressing one picks it and drags it", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    render(<EditorViewport />);
    await act(async () => {});
    const others = screen.getByTestId("other-grids");
    const hit = others.querySelector<SVGRectElement>("[data-hit='other-grid']");
    expect(hit?.dataset.grid).toBe("0");
    const svg = screen.getByRole("img", { name: "Page canvas" });
    fireEvent.pointerDown(hit as SVGRectElement, at({ x: 0.3, y: 0.2 }));
    expect(store().activeGrid).toBe(0);
    fireEvent.pointerMove(svg, at({ x: 0.33, y: 0.22 }));
    fireEvent.pointerUp(svg, at({ x: 0.33, y: 0.22 }));
    expect(group().grids[0].selection?.x).toBeGreaterThan(TOP.x);
    // The grid that was being edited stays where it was.
    expect(group().grids[1].selection).toEqual(BOTTOM);
  });

  it("turns only the picked grid into pieces", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    render(<TurnIntoPiecesButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn into pieces" }));
    });
    expect(store().freeform[0]).toHaveLength(3);
    expect(group().grids.map((r) => r.selection)).toEqual([TOP, null]);
  });
});

describe("the Grids and pieces panel", () => {
  it("lists the page's freeform pieces after the grids, picks one with the Piece tool and deletes one", () => {
    store().addFreeformCard(0, { center: { x: 0.8, y: 0.8 }, width: 0.1, height: 0.1, angle_deg: 0 });
    store().addFreeformCard(0, { center: { x: 0.8, y: 0.6 }, width: 0.1, height: 0.1, angle_deg: 0 });
    render(<GridsPanel />);
    expect(screen.getByText("Freeform pieces (2)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Piece 2" }));
    expect(useEditorStore.getState().tool).toBe("card");
    expect(useEditorStore.getState().selectedCard).toEqual({ page: 0, index: 1 });
    expect(screen.getByRole("button", { name: "Piece 2" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Delete Piece 1" }));
    expect(store().freeform[0]).toHaveLength(1);
  });

  it("gives a grid any color, and keeps the bin on the last grid, which then only loses its region", () => {
    render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Color of Grid 1" }));
    fireEvent.change(screen.getByLabelText("Add a color of your own"), { target: { value: "#AB12CD" } });
    expect(group().grids[0].color).toBe("#ab12cd");
    // The colour is kept with the user's own ones, for every project.
    expect(usePreferencesStore.getState().prefs.gridColors).toEqual(["#ab12cd"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Grid 1" }));
    expect(group().grids).toHaveLength(1);
    expect(group().grids[0].selection).toBeNull();
  });

  it("says when the page is skipped", () => {
    store().setSkipped(0, true);
    render(<GridsPanel />);
    expect(screen.getByText("This page is skipped: it has no grids.")).toBeTruthy();
  });
});

describe("right-click menus", () => {
  const menu = () => screen.getByTestId("context-menu");
  const pick = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

  it("moves a grid up, into a new folder and out of it again, from its row", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    const { rerender } = render(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Grid 1/ }));
    expect(screen.getByRole("menuitem", { name: "Move up" }).hasAttribute("disabled")).toBe(true);
    pick("Move down");
    expect(group().grids.map((r) => r.selection)).toEqual([BOTTOM, TOP]);
    expect(screen.queryByTestId("context-menu")).toBeNull();
    rerender(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Grid 2/ }));
    pick("Move to a new folder");
    expect(group().grids.map((r) => r.folder)).toEqual(["Folder 1", undefined]);
    rerender(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Grid 1/ }));
    pick("Take out of Folder 1");
    expect(group().grids[0].folder).toBeUndefined();
  });

  it("hides, ungroups and deletes from the rows' menus, and Esc closes a menu", () => {
    store().addGrid(0);
    store().setGridLook(0, 0, { folder: "Cards" });
    const { rerender } = render(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Cards/ }));
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("context-menu")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Cards/ }));
    pick("Hide");
    expect(group().grids[0].hidden).toBe(true);
    rerender(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Cards/ }));
    pick("Ungroup");
    expect(group().grids[0].folder).toBeUndefined();
    rerender(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Grid 2/ }));
    pick("Delete");
    expect(group().grids).toHaveLength(1);
  });

  it("keeps the user's own colors, and deletes one with a right-click; a press outside closes the colors", () => {
    usePreferencesStore.getState().addGridColor("#123456");
    render(
      <>
        <GridsPanel />
        <ContextMenuHost />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Color of Grid 1" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "#123456" }));
    pick("Delete color");
    expect(usePreferencesStore.getState().prefs.gridColors).toEqual([]);
    // The menu belongs to the colors: they are still open after using it.
    expect(screen.getByRole("dialog", { name: "Grid color" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Grid color" })).toBeNull();
  });

  it("hides or deletes a grid from the page", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    render(
      <>
        <EditorViewport />
        <ContextMenuHost />
      </>,
    );
    await act(async () => {});
    const other = screen.getByTestId("other-grids").querySelector<SVGRectElement>("[data-hit='other-grid']");
    fireEvent.contextMenu(other as SVGRectElement, at({ x: 0.3, y: 0.2 }));
    pick("Hide Grid 1");
    expect(group().grids[0].hidden).toBe(true);
    const body = screen.getByRole("img", { name: "Page canvas" }).querySelector<SVGRectElement>("[data-hit='body']");
    fireEvent.contextMenu(body as SVGRectElement, at({ x: 0.3, y: 0.7 }));
    pick("Delete Grid 2");
    expect(group().grids.map((r) => r.selection)).toEqual([TOP]);
  });

  it("finds the piece or grid under the pointer whichever tool is on", async () => {
    store().addFreeformCard(0, { center: { x: 0.85, y: 0.85 }, width: 0.1, height: 0.1, angle_deg: 0 });
    render(
      <>
        <EditorViewport />
        <ContextMenuHost />
      </>,
    );
    await act(async () => {});
    const svg = screen.getByRole("img", { name: "Page canvas" });
    // The Grid region tool, on a piece.
    fireEvent.contextMenu(svg, at({ x: 0.85, y: 0.85 }));
    pick("Delete piece");
    expect(store().freeform[0]).toBeUndefined();
    // The Piece tool, on a grid; a right-click on the empty page opens nothing.
    act(() => useEditorStore.setState({ tool: "card" }));
    fireEvent.contextMenu(svg, at({ x: 0.9, y: 0.6 }));
    expect(screen.queryByTestId("context-menu")).toBeNull();
    fireEvent.contextMenu(svg, at({ x: 0.3, y: 0.2 }));
    pick("Hide Grid 1");
    expect(group().grids[0].hidden).toBe(true);
  });
});

describe("the Select tool", () => {
  const PIECE = { center: { x: 0.85, y: 0.85 }, width: 0.1, height: 0.1, angle_deg: 0 };
  const drag = (el: Element, from: Point, to: Point) => {
    const svg = screen.getByRole("img", { name: "Page canvas" });
    fireEvent.pointerDown(el, at(from));
    fireEvent.pointerMove(svg, at(to));
    fireEvent.pointerUp(svg, at(to));
  };

  it("picks and drags a piece or a grid, whichever is pressed, and draws nothing on the empty page", async () => {
    store().addFreeformCard(0, PIECE);
    useEditorStore.setState({ tool: "pick", pickedRegion: 0 });
    render(<EditorViewport />);
    await act(async () => {});
    const svg = screen.getByRole("img", { name: "Page canvas" });
    // A piece: picked on its own, and moved.
    drag(svg.querySelector("[data-hit='card'][data-card='0']") as Element, { x: 0.85, y: 0.85 }, { x: 0.8, y: 0.8 });
    expect(useEditorStore.getState().pickedCards).toEqual([0]);
    expect(useEditorStore.getState().pickedRegion).toBeNull();
    expect(store().freeform[0][0].center.x).toBeLessThan(0.85);
    // The grid: picked instead of the piece, and moved.
    drag(svg.querySelector("[data-hit='body']") as Element, { x: 0.3, y: 0.2 }, { x: 0.35, y: 0.25 });
    expect(useEditorStore.getState().selectedCard).toBeNull();
    expect(useEditorStore.getState().pickedRegion).toBe(0);
    expect(group().grids[0].selection?.x).toBeGreaterThan(TOP.x);
    // The empty page: nothing is drawn, and nothing stays picked.
    const before = group().grids[0].selection;
    drag(svg, { x: 0.1, y: 0.6 }, { x: 0.3, y: 0.8 });
    expect(group().grids[0].selection).toEqual(before);
    expect(store().freeform[0]).toHaveLength(1);
    expect(useEditorStore.getState().pickedRegion).toBeNull();
  });

  it("picks another grid on the page, and the list keeps the tool", async () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    useEditorStore.setState({ tool: "pick" });
    render(<EditorViewport />);
    await act(async () => {});
    const other = screen.getByTestId("other-grids").querySelector("[data-hit='other-grid']") as Element;
    fireEvent.pointerDown(other, at({ x: 0.3, y: 0.2 }));
    fireEvent.pointerUp(other, at({ x: 0.3, y: 0.2 }));
    expect(store().activeGrid).toBe(0);
    cleanup();
    render(<GridsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^Grid 2/ }));
    expect(useEditorStore.getState().tool).toBe("pick");
  });
});

describe("the Select tool after drawing a grid", () => {
  const draw = async () => {
    store().resetDocument(1);
    useEditorStore.setState({ tool: "grid" });
    render(<EditorViewport />);
    await act(async () => {});
    const svg = screen.getByRole("img", { name: "Page canvas" });
    fireEvent.pointerDown(svg, at({ x: 0.1, y: 0.1 }));
    fireEvent.pointerMove(svg, at({ x: 0.5, y: 0.5 }));
    fireEvent.pointerUp(svg, at({ x: 0.5, y: 0.5 }));
  };

  it("switches to it once a grid is drawn, with the grid picked", async () => {
    await draw();
    expect(group().grids[0].selection).not.toBeNull();
    expect(useEditorStore.getState().tool).toBe("pick");
    expect(useEditorStore.getState().pickedRegion).toBe(0);
  });

  it("stays on the Grid tool when Preferences turn that off", async () => {
    usePreferencesStore.getState().setSelectAfterGrid(false);
    await draw();
    expect(useEditorStore.getState().tool).toBe("grid");
  });
});
