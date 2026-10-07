import { describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "./card";
import { applyGridTo, defaultGroups, patchGrid, setSkipped, updateGridGroup } from "./document-layout";
import {
  adjustQuantity,
  clampQuantity,
  clickCard,
  commonQuantity,
  EMPTY_SELECTION,
  filterCards,
  oneOfEach,
  pruneSelection,
  setQuantity,
} from "./library";
import type { Card } from "./sheet-api";

const card = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: { center: { x: 0, y: 0 }, width: 1, height: 1, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const k = (page: number, row: number, column: number) => cardIdKey(gridCardId(0, page, row, column));

// Two pages of 2 x 2 cards, in page order.
const cards = [0, 1].flatMap((p) => [card(p, 0, 0), card(p, 0, 1), card(p, 1, 0), card(p, 1, 1)]);
const visible = cards.map((c) => cardIdKey(c.id));

describe("filterCards", () => {
  const sel = { x: 0, y: 0, width: 1, height: 1 };
  let groups = updateGridGroup(defaultGroups(2), 0, (g) => ({ ...g, selection: sel }));
  groups = applyGridTo(groups, 0, [1]);
  groups = updateGridGroup(groups, 1, (g) => ({ ...g, grid: patchGrid(g.grid, { rows: 2 }) }));
  const docs = [{ id: 0, groups }];

  it("shows everything, one group or one page", () => {
    expect(filterCards(cards, docs, { kind: "all" })).toHaveLength(8);
    expect(filterCards(cards, docs, { kind: "group", document: 0, index: 1 }).map((c) => c.id.page_index)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(filterCards(cards, docs, { kind: "page", document: 0, page: 0 })).toHaveLength(4);
    expect(filterCards(cards, docs, { kind: "page", document: 0, page: 7 })).toEqual([]);
  });

  it("shows nothing for a group that no longer exists", () => {
    const fewer = [{ id: 0, groups: setSkipped(groups, 1, true).slice(0, 1) }];
    expect(filterCards(cards, fewer, { kind: "group", document: 0, index: 3 })).toEqual([]);
  });

  it("tells the cards of different PDFs apart", () => {
    const other = (page: number, row: number, column: number): Card => ({
      ...card(page, row, column),
      id: gridCardId(1, page, row, column),
    });
    const mixed = [...cards, other(0, 0, 0), other(0, 0, 1)];
    const both = [...docs, { id: 1, groups: defaultGroups(1) }];
    expect(filterCards(mixed, both, { kind: "document", document: 1 })).toHaveLength(2);
    expect(filterCards(mixed, both, { kind: "document", document: 0 })).toHaveLength(8);
    // Page 0 of document 1 is not page 0 of document 0.
    expect(filterCards(mixed, both, { kind: "page", document: 1, page: 0 })).toHaveLength(2);
    expect(filterCards(mixed, both, { kind: "group", document: 1, index: 0 })).toHaveLength(2);
    expect(filterCards(mixed, both, { kind: "document", document: 5 })).toEqual([]);
  });
});

describe("clickCard", () => {
  it("selects one card, replacing the selection", () => {
    const a = clickCard(EMPTY_SELECTION, k(0, 0, 0), visible, "none");
    expect(a).toEqual({ selected: [k(0, 0, 0)], anchor: k(0, 0, 0) });
    expect(clickCard(a, k(0, 1, 1), visible, "none").selected).toEqual([k(0, 1, 1)]);
  });

  it("toggles with Ctrl/Cmd", () => {
    let s = clickCard(EMPTY_SELECTION, k(0, 0, 0), visible, "none");
    s = clickCard(s, k(0, 1, 0), visible, "toggle");
    expect(s.selected).toEqual([k(0, 0, 0), k(0, 1, 0)]);
    s = clickCard(s, k(0, 0, 0), visible, "toggle");
    expect(s.selected).toEqual([k(0, 1, 0)]);
  });

  it("selects a range from the anchor, in either direction", () => {
    const s = clickCard(EMPTY_SELECTION, k(0, 0, 1), visible, "none");
    expect(clickCard(s, k(1, 0, 0), visible, "range").selected).toEqual(visible.slice(1, 5));
    const back = clickCard(clickCard(EMPTY_SELECTION, k(1, 0, 0), visible, "none"), k(0, 0, 1), visible, "range");
    expect(back.selected).toEqual(visible.slice(1, 5));
    expect(back.anchor).toBe(k(1, 0, 0));
  });

  it("falls back to a single selection when there is no usable anchor", () => {
    expect(clickCard(EMPTY_SELECTION, k(0, 1, 1), visible, "range").selected).toEqual([k(0, 1, 1)]);
    const gone = { selected: ["x"], anchor: "not-in-the-list" };
    expect(clickCard(gone, k(0, 0, 0), visible, "range").selected).toEqual([k(0, 0, 0)]);
  });

  it("drops selected cards that no longer exist", () => {
    const s = { selected: [k(0, 0, 0), "gone"], anchor: "gone" };
    expect(pruneSelection(s, new Set(visible))).toEqual({ selected: [k(0, 0, 0)], anchor: null });
    expect(pruneSelection(EMPTY_SELECTION, new Set(visible))).toBe(EMPTY_SELECTION);
  });
});

describe("quantities", () => {
  it("clamps to 0..99 and whole numbers", () => {
    expect([clampQuantity(-4), clampQuantity(3.6), clampQuantity(250), clampQuantity(Number.NaN)]).toEqual([
      0, 4, 99, 0,
    ]);
  });

  it("sets a quantity on several cards, and removes the entry at zero", () => {
    const a = setQuantity({}, [k(0, 0, 0), k(0, 0, 1)], 4);
    expect(a).toEqual({ [k(0, 0, 0)]: 4, [k(0, 0, 1)]: 4 });
    expect(setQuantity(a, [k(0, 0, 0)], 0)).toEqual({ [k(0, 0, 1)]: 4 });
    expect(a[k(0, 0, 0)]).toBe(4); // the input is not changed
  });

  it("steps each card on its own", () => {
    const q = { [k(0, 0, 0)]: 2 };
    const next = adjustQuantity(q, [k(0, 0, 0), k(0, 0, 1)], 1);
    expect(next).toEqual({ [k(0, 0, 0)]: 3, [k(0, 0, 1)]: 1 });
    expect(adjustQuantity(next, [k(0, 0, 1)], -5)).toEqual({ [k(0, 0, 0)]: 3 });
    expect(adjustQuantity({ a: 99 }, ["a"], 1)).toEqual({ a: 99 });
  });

  it("reports a shared quantity, or none when they differ", () => {
    const q = { a: 2, b: 2, c: 3 };
    expect(commonQuantity(q, ["a", "b"])).toBe(2);
    expect(commonQuantity(q, ["a", "c"])).toBeNull();
    expect(commonQuantity(q, ["z", "y"])).toBe(0);
    expect(commonQuantity(q, [])).toBeNull();
  });

  it("starts a custom plan from one of each", () => {
    const q = oneOfEach(cards);
    expect(Object.keys(q)).toHaveLength(8);
    expect(new Set(Object.values(q))).toEqual(new Set([1]));
  });
});
