import { beforeEach, describe, expect, it } from "vitest";
import { gridGroupAt } from "../lib/document-layout";
import { beginEdit, endEdit, redo, undo, useLayoutStore } from "./layout-store";
import { usePrintStore } from "./print-store";

const store = () => useLayoutStore.getState();
const history = () => useLayoutStore.temporal.getState();
const card = (x: number, angle = 0) => ({ center: { x, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: angle });

beforeEach(() => {
  store().resetDocument(6);
});

describe("freeform cards", () => {
  it("keeps cards per page, next to the grid, and numbers them in the order they were drawn", () => {
    store().setSelection(0, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(store().addFreeformCard(0, card(0.2))).toBe(0);
    expect(store().addFreeformCard(0, card(0.5, 7))).toBe(1);
    expect(store().addFreeformCard(3, card(0.4))).toBe(0);
    expect(store().freeform[0]).toHaveLength(2);
    expect(store().freeform[3]).toHaveLength(1);
    // A page keeps its grid region as well.
    expect(gridGroupAt(store().groups, 0)?.selection).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
  });

  it("updates one card, and ignores a card that is not there", () => {
    store().addFreeformCard(0, card(0.2));
    store().updateFreeformCard(0, 0, card(0.6, 12));
    expect(store().freeform[0][0]).toEqual(card(0.6, 12));
    const before = store().freeform;
    store().updateFreeformCard(0, 5, card(0.1));
    store().updateFreeformCard(4, 0, card(0.1));
    expect(store().freeform).toBe(before);
  });

  it("deleting a card renumbers the later ones together with their turn, scale and place in the order", () => {
    for (const x of [0.1, 0.2, 0.3]) store().addFreeformCard(1, card(x));
    store().setCardEdits({
      turns: { "f:0:1:1": 90, "f:0:1:2": 180 },
      scales: { "f:0:1:2": 0.9 },
      order: ["f:0:1:2", "f:0:1:0", "f:0:1:1"],
    });
    store().deleteFreeformCard(1, 1);
    expect(store().freeform[1].map((c) => c.center.x)).toEqual([0.1, 0.3]);
    expect(store().cardEdits).toEqual({
      turns: { "f:0:1:1": 180 },
      scales: { "f:0:1:1": 0.9 },
      order: ["f:0:1:1", "f:0:1:0"],
    });
    // The last card of a page leaves no empty entry behind.
    store().deleteFreeformCard(1, 0);
    store().deleteFreeformCard(1, 0);
    expect(store().freeform[1]).toBeUndefined();
  });

  it("undoes and redoes drawing and deleting, restoring the card edits with them", () => {
    store().addFreeformCard(0, card(0.2));
    store().addFreeformCard(0, card(0.5));
    store().setCardEdits({ turns: { "f:0:0:1": 90 }, scales: {}, order: [] });
    store().deleteFreeformCard(0, 0);
    expect(store().cardEdits.turns).toEqual({ "f:0:0:0": 90 });
    undo();
    expect(store().freeform[0]).toHaveLength(2);
    expect(store().cardEdits.turns).toEqual({ "f:0:0:1": 90 });
    redo();
    expect(store().cardEdits.turns).toEqual({ "f:0:0:0": 90 });
    for (let i = 0; i < 4; i++) undo();
    expect(store().freeform[0]).toBeUndefined();
  });

  it("makes one undo step of a whole drag", () => {
    store().addFreeformCard(0, card(0.2));
    const steps = history().pastStates.length;
    beginEdit();
    for (const x of [0.25, 0.3, 0.35, 0.4]) store().updateFreeformCard(0, 0, card(x));
    endEdit();
    expect(history().pastStates).toHaveLength(steps + 1);
    undo();
    expect(store().freeform[0][0]).toEqual(card(0.2));
  });

  it("moves the Print stage's copies and selection along when a card is deleted", () => {
    for (const x of [0.1, 0.2, 0.3]) store().addFreeformCard(0, card(x));
    usePrintStore.setState({
      mode: "custom",
      quantities: { "f:0:0:0": 2, "f:0:0:1": 5, "f:0:0:2": 3, "g:0:0:0:1": 9 },
      selection: { selected: ["f:0:0:1", "f:0:0:2"], anchor: "f:0:0:1" },
    });
    store().deleteFreeformCard(0, 1);
    expect(usePrintStore.getState().quantities).toEqual({ "f:0:0:0": 2, "f:0:0:1": 3, "g:0:0:0:1": 9 });
    expect(usePrintStore.getState().selection).toEqual({ selected: ["f:0:0:1"], anchor: null });
  });

  it("forgets the cards and edits when a new document opens", () => {
    store().addFreeformCard(0, card(0.2));
    store().setCardEdits({ turns: { "f:0:0:0": 90 }, scales: {}, order: [] });
    store().resetDocument(2);
    expect(store().freeform).toEqual({});
    expect(store().cardEdits).toEqual({ turns: {}, scales: {}, order: [] });
  });
});
