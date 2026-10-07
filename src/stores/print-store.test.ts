import { beforeEach, describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "../lib/card";
import type { Card } from "../lib/sheet-api";
import { planOf, usePrintStore } from "./print-store";

const card = (column: number): Card => ({
  id: gridCardId(0, 0, 0, column),
  source: { center: { x: 0, y: 0 }, width: 1, height: 1, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cards = [card(0), card(1), card(2)];
const keys = cards.map((c) => cardIdKey(c.id));
const st = () => usePrintStore.getState();

beforeEach(() => {
  st().reset();
  st().setCards(cards, null);
});

describe("print plan", () => {
  it("starts as every card once, in order, each source page on its own sheet", () => {
    expect(planOf(st())).toMatchObject({ mode: "all", autoFill: false, order: "grouped", sheetGrid: "same" });
    expect(st().groupBySize).toBe(true);
  });

  it("switches to a custom selection when a quantity is set, printing only that card", () => {
    st().setQuantity([keys[1]], 9);
    expect(st().mode).toBe("custom");
    expect(st().quantities).toEqual({ [keys[1]]: 9 });
  });

  it("steps quantities and drops cards that reach zero", () => {
    st().adjustQuantity([keys[0], keys[1]], 2);
    st().adjustQuantity([keys[0]], -2);
    expect(st().quantities).toEqual({ [keys[1]]: 2 });
  });

  it("can start from one of every card", () => {
    st().startFromAllCards();
    expect(st().mode).toBe("custom");
    expect(Object.values(st().quantities)).toEqual([1, 1, 1]);
  });

  it("keeps the quantities when going back to all cards and returning", () => {
    st().setQuantity([keys[0]], 4);
    st().setMode("all");
    expect(st().quantities).toEqual({ [keys[0]]: 4 });
    st().setMode("custom");
    expect(st().quantities).toEqual({ [keys[0]]: 4 });
  });

  it("limits the sheet grid to whole numbers from 1", () => {
    st().setRows(0);
    st().setColumns(99);
    expect([st().rows, st().columns]).toEqual([1, 30]);
    st().setRows(2.6);
    expect(st().rows).toBe(3);
  });

  it("resets to the default plan for a new document", () => {
    st().setQuantity([keys[0]], 4);
    st().setAutoFill(true);
    st().reset();
    expect(planOf(st())).toMatchObject({ mode: "all", quantities: {}, autoFill: false });
    expect(st().cards).toEqual([]);
  });
});

describe("selection and sheets", () => {
  it("selects with click, Shift and select all, and prunes cards that disappear", () => {
    st().clickCard(keys[0], keys, "none");
    st().clickCard(keys[2], keys, "range");
    expect(st().selection.selected).toEqual(keys);
    st().clearSelection();
    st().selectAll(keys);
    expect(st().selection.selected).toEqual(keys);
    st().setCards([cards[0]], null);
    expect(st().selection.selected).toEqual([keys[0]]);
  });

  it("keeps the shown sheet inside the sheets that exist", () => {
    const sheet = { page: { width_pt: 1, height_pt: 1 }, placements: [] };
    st().setSheets([sheet, sheet, sheet], null);
    st().setCurrentSheet(2);
    st().setSheets([sheet], null);
    expect(st().currentSheet).toBe(0);
    st().setSheets(null, "boom");
    expect(st().currentSheet).toBe(0);
    expect(st().sheetsError).toBe("boom");
  });
});
