import { beforeEach, describe, expect, it } from "vitest";
import { gridGroupAt, type PageGroup } from "../lib/document-layout";
import { beginEdit, endEdit, redo, undo, useLayoutStore } from "./layout-store";

const sel = (x: number) => ({ x, y: 0.1, width: 0.5, height: 0.5 });
const store = () => useLayoutStore.getState();
const history = () => useLayoutStore.temporal.getState();
const selectionOf = (groups: PageGroup[], page = 0) => gridGroupAt(groups, page)?.selection ?? null;

beforeEach(() => {
  store().resetDocument(6);
});

describe("document layout in the store", () => {
  it("starts with one grid group over all pages and no history", () => {
    expect(store().groups).toHaveLength(1);
    expect(history().pastStates).toHaveLength(0);
  });

  it("applies the region to the whole group", () => {
    store().setSelection(2, sel(0.1));
    expect(selectionOf(store().groups, 0)).toEqual(sel(0.1));
    expect(selectionOf(store().groups, 5)).toEqual(sel(0.1));
  });

  it("forgets history when a new document opens", () => {
    store().setSelection(0, sel(0.1));
    store().resetDocument(3);
    expect(history().pastStates).toHaveLength(0);
    expect(selectionOf(store().groups)).toBeNull();
  });
});

describe("undo and redo", () => {
  it("undoes and redoes drawing the region", () => {
    store().setSelection(0, sel(0.1));
    undo();
    expect(selectionOf(store().groups)).toBeNull();
    redo();
    expect(selectionOf(store().groups)).toEqual(sel(0.1));
  });

  it("undoes grid edits", () => {
    store().setGrid(0, { rows: 2, columns: 4 });
    undo();
    const g = gridGroupAt(store().groups, 0);
    expect([g?.grid.rows, g?.grid.columns]).toEqual([3, 3]);
  });

  it("undoes page skips and group splits", () => {
    store().setSkipped(2, true);
    expect(store().groups).toHaveLength(3);
    undo();
    expect(store().groups).toHaveLength(1);
  });

  it("undoes applying a grid to other pages", () => {
    store().setSelection(0, sel(0.1));
    store().applyGrid(0, [4]);
    expect(store().groups.length).toBeGreaterThan(1);
    undo();
    expect(store().groups).toHaveLength(1);
  });

  it("undoes output settings", () => {
    store().setGapX(8);
    undo();
    expect([store().gapXMm, store().gapYMm]).toEqual([3, 3]);
  });

  it("clears the redo steps when something new is edited", () => {
    store().setSelection(0, sel(0.1));
    undo();
    store().setSelection(0, sel(0.3));
    redo();
    expect(selectionOf(store().groups)).toEqual(sel(0.3));
  });

  it("does not record preview results or the live flag", () => {
    store().setResult(null, "x");
    store().setLive(!store().live);
    store().clearSnapshot();
    expect(history().pastStates).toHaveLength(0);
  });

  it("does nothing with an empty history", () => {
    undo();
    redo();
    expect(store().groups).toHaveLength(1);
  });
});

describe("one undo step per drag", () => {
  it("groups the moves of a drag into a single step", () => {
    store().setSelection(0, sel(0.1)); // an earlier step
    beginEdit();
    for (const x of [0.15, 0.2, 0.25, 0.3]) store().setSelection(0, sel(x));
    endEdit();
    expect(history().pastStates).toHaveLength(2);
    undo();
    expect(selectionOf(store().groups)).toEqual(sel(0.1)); // back to before the drag, not one move
    undo();
    expect(selectionOf(store().groups)).toBeNull();
  });

  it("makes no step for a drag that changed nothing", () => {
    beginEdit();
    endEdit();
    expect(history().pastStates).toHaveLength(0);
  });

  it("records the first drag of a document, drawing a region from nothing", () => {
    beginEdit();
    store().setSelection(0, sel(0.1));
    store().setSelection(0, sel(0.2));
    endEdit();
    undo();
    expect(selectionOf(store().groups)).toBeNull();
    redo();
    expect(selectionOf(store().groups)).toEqual(sel(0.2));
  });

  it("is safe to end twice, and to begin twice", () => {
    beginEdit();
    beginEdit();
    store().setSelection(0, sel(0.1));
    endEdit();
    endEdit();
    expect(history().pastStates).toHaveLength(1);
    // Tracking is back on for the next edit.
    store().setSelection(0, sel(0.2));
    expect(history().pastStates).toHaveLength(2);
  });

  it("closes a drag that is still open when undo is pressed", () => {
    store().setSelection(0, sel(0.1));
    beginEdit();
    store().setSelection(0, sel(0.4));
    undo();
    expect(selectionOf(store().groups)).toEqual(sel(0.1));
  });

  it("drops redo steps after a drag", () => {
    store().setSelection(0, sel(0.1));
    undo();
    beginEdit();
    store().setSelection(0, sel(0.5));
    endEdit();
    expect(history().futureStates).toHaveLength(0);
  });
});
