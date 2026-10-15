import { beforeEach, describe, expect, it } from "vitest";
import { gridGroupAt } from "../lib/document-layout";
import { useDocumentStore } from "./document-store";
import { getCurrentSelection, getOtherSelections, undo, useLayoutStore } from "./layout-store";
import { usePrintStore } from "./print-store";

const store = () => useLayoutStore.getState();
const PAGE = { width_pt: 600, height_pt: 800 };
const TOP = { x: 0.1, y: 0.05, width: 0.8, height: 0.4 };
const BOTTOM = { x: 0.1, y: 0.6, width: 0.5, height: 0.2 };
const grids = (page = 0) => gridGroupAt(store().groups, page)?.grids ?? [];

beforeEach(() => {
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.pdf", pages: Array(4).fill(PAGE), hash: "" }], 0);
  useDocumentStore.setState({ currentPage: 0 });
  store().resetDocument(4);
  usePrintStore.getState().reset();
  store().setSelection(0, TOP);
});

describe("several grids on one page", () => {
  it("adds a grid with no region and edits it from then on", () => {
    store().addGrid(0);
    expect(grids()).toHaveLength(2);
    expect(store().activeGrid).toBe(1);
    expect(getCurrentSelection()).toBeNull();
    store().setSelection(0, BOTTOM);
    store().setGrid(0, { rows: 1, columns: 4 });
    expect(grids()[0]).toMatchObject({ selection: TOP, grid: { rows: 3, columns: 3 } });
    expect(grids()[1]).toMatchObject({ selection: BOTTOM, grid: { rows: 1, columns: 4 } });
    // The whole group has both: page 3 too.
    expect(grids(3)[1].selection).toEqual(BOTTOM);
    expect(getOtherSelections()).toEqual([{ n: 0, selection: TOP }]);
  });

  it("undoes adding a grid in one step and reads past the end as the last grid", () => {
    store().addGrid(0);
    undo();
    expect(grids()).toHaveLength(1);
    expect(getCurrentSelection()).toEqual(TOP);
  });

  it("deletes a grid with its pieces' edits and copies, and renumbers the grids after it", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    store().addGrid(0);
    store().setSelection(0, { ...BOTTOM, x: 0.65, width: 0.3 });
    store().setCardEdits({
      turns: { "g:0:0:0:0": 90, "g:0:0:0:0:1": 180, "g:0:1:0:0:2": 270 },
      scales: {},
      order: ["g:0:0:0:0:2", "g:0:0:0:0:1", "g:0:0:0:0"],
      backs: { "g:0:0:0:0": "g:0:0:0:0:2", "g:0:0:0:1": "g:0:0:0:0:1" },
    });
    usePrintStore.setState({
      quantities: { "g:0:0:0:0": 1, "g:0:0:0:0:1": 2, "g:0:0:0:0:2": 3 },
      selection: { selected: ["g:0:0:0:0:1", "g:0:0:0:0:2"], anchor: "g:0:0:0:0:1" },
    });
    store().deleteGrid(0, 1);
    expect(grids()).toHaveLength(2);
    expect(grids()[1].selection?.x).toBe(0.65);
    expect(store().cardEdits).toEqual({
      turns: { "g:0:0:0:0": 90, "g:0:1:0:0:1": 270 },
      scales: {},
      order: ["g:0:0:0:0:1", "g:0:0:0:0"],
      backs: { "g:0:0:0:0": "g:0:0:0:0:1" },
    });
    expect(usePrintStore.getState().quantities).toEqual({ "g:0:0:0:0": 1, "g:0:0:0:0:1": 3 });
    expect(usePrintStore.getState().selection).toEqual({ selected: ["g:0:0:0:0:1"], anchor: null });
  });

  it("keeps one grid: deleting the last only clears its region", () => {
    store().deleteGrid(0, 0);
    expect(grids()).toHaveLength(1);
    expect(grids()[0].selection).toBeNull();
  });

  it("goes back to the first grid when the page moves to another group", () => {
    store().addGrid(0);
    store().applyGrid(0, [3], "all");
    expect(grids(3)).toHaveLength(2);
    expect(store().activeGrid).toBe(1);
    useDocumentStore.setState({ currentPage: 1 }); // same group
    expect(store().activeGrid).toBe(1);
    useDocumentStore.setState({ currentPage: 3 }); // its own group now
    expect(store().activeGrid).toBe(0);
  });

  it("copies one grid or all of them with Apply this grid to", () => {
    store().addGrid(0);
    store().setSelection(0, BOTTOM);
    store().applyGrid(0, [2]);
    expect(grids(2).map((r) => r.selection)).toEqual([BOTTOM]);
    store().applyGrid(0, [3], "all");
    expect(grids(3).map((r) => r.selection)).toEqual([TOP, BOTTOM]);
  });

  it("puts detected grids in the page's grids, in order, keeping the first grid's place", () => {
    const detected = (selection: typeof TOP, rows: number, columns: number) => ({
      selection,
      rows,
      columns,
      sourceGapXMm: 0,
      sourceGapYMm: 0,
      sourceGapLinked: true,
    });
    store().applyDetectedGrids(0, [detected(BOTTOM, 1, 4), detected(TOP, 2, 2)]);
    expect(grids().map((r) => [r.selection, r.grid.rows, r.grid.columns])).toEqual([
      [BOTTOM, 1, 4],
      [TOP, 2, 2],
    ]);
    // Fewer grids found than the page has: the rest lose their region.
    store().applyDetectedGrids(0, [detected(TOP, 3, 3)]);
    expect(grids().map((r) => r.selection)).toEqual([TOP, null]);
    undo();
    expect(grids()[1].selection).toEqual(TOP);
  });
});
