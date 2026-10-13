import { beforeEach, describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "../lib/card";
import { gridGroupAt } from "../lib/document-layout";
import type { Card } from "../lib/sheet-api";
import { useDocumentStore } from "./document-store";
import { redo, undo, useLayoutStore } from "./layout-store";
import { usePrintStore } from "./print-store";

const store = () => useLayoutStore.getState();
const PAGE = { width_pt: 600, height_pt: 800 };
const REGION = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
const cell = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: { center: { x: 100 + column * 200, y: 100 + row * 200 }, width: 180, height: 190, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cellsOf = (...pages: number[]) =>
  pages.flatMap((p) => [cell(p, 0, 0), cell(p, 0, 1), cell(p, 1, 0), cell(p, 1, 1)]);

beforeEach(() => {
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.pdf", pages: Array(4).fill(PAGE), hash: "" }], 0);
  store().resetDocument(4);
  usePrintStore.getState().reset();
  store().setSelection(0, REGION);
});

describe("turning a grid into pieces", () => {
  it("makes a freeform piece of every cell and clears the region, as one undo step", () => {
    expect(store().turnGridIntoPieces(0, false, cellsOf(0, 1, 2, 3))).toBe(16);
    // The group had every page: all of them now have their pieces.
    for (const p of [0, 1, 2, 3]) expect(store().freeform[p]).toHaveLength(4);
    expect(gridGroupAt(store().groups, 0)?.selection).toBeNull();
    expect(store().freeform[0][0].center).toEqual({ x: 100 / 600, y: 100 / 800 });
    undo();
    expect(store().freeform).toEqual({});
    expect(gridGroupAt(store().groups, 0)?.selection).toEqual(REGION);
    redo();
    expect(store().freeform[0]).toHaveLength(4);
  });

  it("on this page only, takes the page out of its group and leaves the others their grid", () => {
    expect(store().turnGridIntoPieces(1, true, cellsOf(1))).toBe(4);
    expect(store().freeform[1]).toHaveLength(4);
    expect(store().freeform[0]).toBeUndefined();
    expect(gridGroupAt(store().groups, 1)?.selection).toBeNull();
    expect(gridGroupAt(store().groups, 1)?.pages).toEqual({ first: 1, last: 1 });
    expect(gridGroupAt(store().groups, 0)?.selection).toEqual(REGION);
    expect(gridGroupAt(store().groups, 2)?.selection).toEqual(REGION);
  });

  it("does nothing without a region or without cells", () => {
    expect(store().turnGridIntoPieces(0, false, [])).toBe(0);
    store().setSelection(0, null);
    expect(store().turnGridIntoPieces(0, false, cellsOf(0))).toBe(0);
    expect(store().freeform).toEqual({});
  });

  it("keeps what the user set for each piece, and the copies, selection and common back in the Print stage", () => {
    const [first, second] = [cardIdKey(gridCardId(0, 0, 0, 0)), cardIdKey(gridCardId(0, 0, 0, 1))];
    store().setCardEdits({
      turns: { [first]: 90 },
      scales: { [second]: 0.9 },
      order: [second, first],
      backs: { [first]: second },
    });
    const print = usePrintStore.getState();
    print.setCards(cellsOf(0), null);
    print.setQuantity([first, second], 3);
    print.selectAll([first]);
    store().turnGridIntoPieces(0, true, cellsOf(0));
    expect(store().cardEdits).toEqual({
      turns: { "f:0:0:0": 90 },
      scales: { "f:0:0:1": 0.9 },
      order: ["f:0:0:1", "f:0:0:0"],
      backs: { "f:0:0:0": "f:0:0:1" },
    });
    const after = usePrintStore.getState();
    expect(after.quantities).toEqual({ "f:0:0:0": 3, "f:0:0:1": 3 });
    expect(after.selection.selected).toEqual(["f:0:0:0"]);
  });

  it("puts the new pieces after the page's own, so a second size can be added the same way", () => {
    store().addFreeformCard(0, { center: { x: 0.9, y: 0.9 }, width: 0.1, height: 0.1, angle_deg: 0 });
    store().turnGridIntoPieces(0, true, cellsOf(0));
    expect(store().freeform[0]).toHaveLength(5);
    expect(store().freeform[0][0].center.x).toBe(0.9);
    // Draw the next grid, turn it too: the first pieces keep their numbers.
    store().setSelection(0, REGION);
    store().turnGridIntoPieces(0, true, cellsOf(0));
    expect(store().freeform[0]).toHaveLength(9);
  });
});
