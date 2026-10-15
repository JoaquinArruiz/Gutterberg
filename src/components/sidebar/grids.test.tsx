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
import { GridsSection } from "./GridsSection";
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
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  store().resetDocument(1);
  store().setSelection(0, TOP);
  useEditorStore.setState({ tool: "select", pickedRegion: null, viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the list of grids", () => {
  it("adds a grid, picked and ready to be drawn with the Grid region tool", () => {
    useEditorStore.setState({ tool: "card" });
    render(<GridsSection group={group()} page={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Add grid" }));
    expect(group().grids).toHaveLength(2);
    expect(store().activeGrid).toBe(1);
    expect(useEditorStore.getState().tool).toBe("select");
  });

  it("picks a grid and deletes one", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    const { rerender } = render(<GridsSection group={group()} page={0} />);
    const first = screen.getByRole("button", { name: /^Grid 1/ });
    fireEvent.click(first);
    expect(store().activeGrid).toBe(0);
    rerender(<GridsSection group={group()} page={0} />);
    expect(screen.getByRole("button", { name: /^Grid 1/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Delete grid 1" }));
    expect(group().grids.map((r) => r.selection)).toEqual([BOTTOM]);
  });
});

describe("several grids on the page", () => {
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
