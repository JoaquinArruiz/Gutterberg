import { beforeEach, describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "../lib/card";
import { clearHistory, redo, undo, useHistory } from "./history";
import { beginEdit, endEdit, useLayoutStore } from "./layout-store";
import { usePrintStore } from "./print-store";

const layout = () => useLayoutStore.getState();
const print = () => usePrintStore.getState();
const key = (n: number) => cardIdKey(gridCardId(0, 0, 0, n));
const canUndo = () => useHistory.getState().canUndo;
const canRedo = () => useHistory.getState().canRedo;

// The output settings outlive a document (they are kept when another PDF opens), so each test restores them.
const output = { gap: layout().gapXMm, top: layout().margins.top };

beforeEach(() => {
  layout().resetDocument(4);
  print().reset();
  layout().setGapX(output.gap);
  layout().setMargin("top", output.top);
  clearHistory();
});

describe("undo for the Print plan", () => {
  it("takes back the copies, and puts them back", () => {
    print().setQuantity([key(0), key(1)], 3);
    expect(print().mode).toBe("custom");
    expect(print().quantities).toEqual({ [key(0)]: 3, [key(1)]: 3 });
    undo();
    expect(print().mode).toBe("all");
    expect(print().quantities).toEqual({});
    redo();
    expect(print().mode).toBe("custom");
    expect(print().quantities).toEqual({ [key(0)]: 3, [key(1)]: 3 });
  });

  it("covers every plan setting, one step each", () => {
    print().setAutoFill(true);
    print().setOrder("interleaved");
    print().setGroupBySize(false);
    print().setSheetGrid("custom");
    print().setRows(4);
    print().setColumns(5);
    print().setBleed({ mm: 2 });
    print().setDuplex({ on: true });
    expect(print().rows).toBe(4);
    for (let i = 0; i < 8; i++) undo();
    expect(print().autoFill).toBe(false);
    expect(print().order).toBe("grouped");
    expect(print().groupBySize).toBe(true);
    expect(print().sheetGrid).toBe("same");
    expect(print().rows).toBe(3);
    expect(print().columns).toBe(3);
    expect(print().finish.bleed.mm).toBe(0);
    expect(print().finish.duplex.on).toBe(false);
    expect(canUndo()).toBe(false);
  });

  it("steps copies one at a time", () => {
    print().adjustQuantity([key(0)], 1);
    print().adjustQuantity([key(0)], 1);
    print().adjustQuantity([key(0)], 1);
    expect(print().quantities[key(0)]).toBe(3);
    undo();
    expect(print().quantities[key(0)]).toBe(2);
    undo();
    expect(print().quantities[key(0)]).toBe(1);
  });

  it("does not record what is not the plan: the selection, the cards, the sheets, the filter", () => {
    print().clickCard(key(0), [key(0), key(1)], "none");
    print().selectAll([key(0), key(1)]);
    print().setFilter({ kind: "page", document: 0, page: 1 });
    print().setCurrentSheet(0);
    print().setSheets([], null);
    print().setPickingBack(true);
    expect(canUndo()).toBe(false);
  });

  it("does not record a change that leaves the plan as it was", () => {
    print().setAutoFill(false);
    print().setOrder("grouped");
    expect(canUndo()).toBe(false);
  });
});

describe("one history for turns and sizes and for the plan", () => {
  it("undoes the last thing done, whichever store it was done in, and redoes in the same order", () => {
    layout().setGapX(5); // 1: the output gap (the layout store)
    print().setQuantity([key(0)], 2); // 2: copies (the print store)
    layout().setMargin("top", 7); // 3: a margin (the layout store)
    print().setAutoFill(true); // 4: the plan again

    undo();
    expect(print().autoFill).toBe(false);
    expect(layout().margins.top).toBe(7);
    undo();
    expect(layout().margins.top).not.toBe(7);
    expect(print().quantities[key(0)]).toBe(2);
    undo();
    expect(print().quantities[key(0)]).toBeUndefined();
    expect(layout().gapXMm).toBe(5);
    undo();
    expect(layout().gapXMm).not.toBe(5);
    expect(canUndo()).toBe(false);

    redo();
    expect(layout().gapXMm).toBe(5);
    redo();
    expect(print().quantities[key(0)]).toBe(2);
    redo();
    expect(layout().margins.top).toBe(7);
    redo();
    expect(print().autoFill).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it("turns and sizes (the layout's piece edits) and copies share the order", () => {
    layout().setCardEdits({ turns: { [key(0)]: 90 }, scales: {}, order: [], backs: {} });
    print().setQuantity([key(0)], 4);
    undo();
    expect(print().quantities).toEqual({});
    expect(layout().cardEdits.turns[key(0)]).toBe(90);
    undo();
    expect(layout().cardEdits.turns).toEqual({});
  });

  it("a new edit drops what could have been redone", () => {
    print().setQuantity([key(0)], 2);
    layout().setGapX(5);
    undo();
    expect(canRedo()).toBe(true);
    print().setAutoFill(true);
    expect(canRedo()).toBe(false);
    redo();
    expect(layout().gapXMm).not.toBe(5);
    expect(print().autoFill).toBe(true);
  });

  it("an edit made while redoing is possible again does the same in either store", () => {
    print().setAutoFill(true);
    undo();
    layout().setGapX(9);
    expect(canRedo()).toBe(false);
  });

  it("a drag in the layout is one step, and sits in the order with the plan's", () => {
    print().setAutoFill(true);
    beginEdit();
    layout().setGapX(11);
    layout().setGapX(12);
    layout().setGapX(13);
    endEdit();
    expect(layout().gapXMm).toBe(13);
    undo();
    expect(layout().gapXMm).toBe(output.gap); // all three moves at once
    expect(print().autoFill).toBe(true);
    undo();
    expect(print().autoFill).toBe(false);
  });

  it("closes a drag in progress before it undoes", () => {
    print().setAutoFill(true);
    beginEdit();
    layout().setGapX(4);
    undo(); // the unfinished drag is the newest step
    expect(layout().gapXMm).not.toBe(4);
    expect(print().autoFill).toBe(true);
  });

  it("reports whether there is anything to undo or redo", () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    print().setAutoFill(true);
    expect(canUndo()).toBe(true);
    undo();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    redo();
    expect(canRedo()).toBe(false);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    undo();
    redo();
    expect(print().autoFill).toBe(false);
    expect(canUndo()).toBe(false);
  });
});

describe("what forgets the history", () => {
  it("a new document forgets the layout's steps and the plan's", () => {
    layout().setGapX(5);
    print().setAutoFill(true);
    layout().resetDocument(2);
    print().reset();
    expect(canUndo()).toBe(false);
    undo();
    expect(print().autoFill).toBe(false);
  });

  it("clearing one store's history leaves the other's steps in place", () => {
    layout().setGapX(5);
    print().setAutoFill(true);
    layout().resetDocument(2);
    expect(canUndo()).toBe(true);
    undo();
    expect(print().autoFill).toBe(false);
    expect(canUndo()).toBe(false);
  });

  it("opening a project's plan starts a fresh history", () => {
    print().setAutoFill(true);
    print().loadPlan({ ...print(), mode: "custom", quantities: { [key(2)]: 5 }, autoFill: false });
    expect(print().quantities).toEqual({ [key(2)]: 5 });
    expect(canUndo()).toBe(false);
  });

  it("removing a PDF drops the plan's earlier steps, which named its pieces", () => {
    print().setQuantity([key(0)], 2);
    print().forgetDocument(0);
    expect(print().quantities).toEqual({});
    expect(canUndo()).toBe(false);
  });

  it("keeps at most the history limit, forgetting the oldest", () => {
    for (let i = 0; i < 230; i++) print().setQuantity([key(0)], (i % 98) + 1 + (i % 2 ? 0 : 0) + (i === 0 ? 0 : 0));
    let steps = 0;
    while (canUndo()) {
      undo();
      steps++;
      if (steps > 400) break;
    }
    expect(steps).toBeLessThanOrEqual(200);
    expect(steps).toBeGreaterThan(0);
  });
});
