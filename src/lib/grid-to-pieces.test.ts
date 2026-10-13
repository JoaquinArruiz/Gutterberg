import { describe, expect, it } from "vitest";
import { cardIdKey, freeformCardId, gridCardId } from "./card";
import { editsAfterDelete, editsAfterRekey, NO_EDITS } from "./card-edits";
import { gridToPieces } from "./grid-to-pieces";
import type { Card } from "./sheet-api";

const PAGE = { width_pt: 600, height_pt: 800 };
const cell = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: {
    center: { x: 100 + column * 200, y: 100 + row * 200 },
    width: 180,
    height: 190,
    angle_deg: 0,
  },
  scale: 1,
  turn: 0,
});

describe("gridToPieces", () => {
  it("makes a freeform piece of every cell, at the same place and size, row by row", () => {
    // The engine's list may come in any order.
    const cards = [cell(0, 1, 0), cell(0, 0, 1), cell(0, 0, 0), cell(0, 1, 1)];
    const { pieces, moves } = gridToPieces(cards, 0, [0], [PAGE], {});
    expect(pieces[0]).toHaveLength(4);
    expect(pieces[0][0]).toEqual({
      center: { x: 100 / 600, y: 100 / 800 },
      width: 180 / 600,
      height: 190 / 800,
      angle_deg: 0,
    });
    expect(pieces[0][1].center.x).toBeCloseTo(300 / 600);
    expect(pieces[0][2].center.y).toBeCloseTo(300 / 800);
    expect(moves).toEqual({
      "g:0:0:0:0": "f:0:0:0",
      "g:0:0:0:1": "f:0:0:1",
      "g:0:0:1:0": "f:0:0:2",
      "g:0:0:1:1": "f:0:0:3",
    });
  });

  it("numbers the new pieces after the page's own freeform pieces", () => {
    const existing = { 0: [{ center: { x: 0.5, y: 0.5 }, width: 0.1, height: 0.1, angle_deg: 0 }] };
    const { moves } = gridToPieces([cell(0, 0, 0), cell(0, 0, 1)], 0, [0], [PAGE], existing);
    expect(moves).toEqual({ "g:0:0:0:0": "f:0:0:1", "g:0:0:0:1": "f:0:0:2" });
  });

  it("takes only the pages and the document asked for", () => {
    const other: Card = { ...cell(0, 0, 0), id: gridCardId(1, 0, 0, 0) };
    const { pieces, moves } = gridToPieces(
      [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), other],
      0,
      [0, 2],
      [PAGE, PAGE, PAGE],
      {},
    );
    expect(Object.keys(pieces)).toEqual(["0", "2"]);
    expect(Object.keys(moves).sort()).toEqual(["g:0:0:0:0", "g:0:2:0:0"]);
  });

  it("leaves out a page without grid pieces, and freeform cards of the engine", () => {
    const free: Card = { ...cell(0, 0, 0), id: freeformCardId(0, 0, 0) };
    expect(gridToPieces([free], 0, [0, 1], [PAGE, PAGE], {})).toEqual({ pieces: {}, moves: {} });
  });
});

describe("editsAfterRekey", () => {
  const moves = { "g:0:0:0:0": "f:0:0:0", "g:0:0:0:1": "f:0:0:1" };

  it("moves turn, size, height, place in the order and backs to the new keys", () => {
    const edits = {
      turns: { "g:0:0:0:0": 90 as const, "g:0:0:1:1": 180 as const },
      scales: { "g:0:0:0:1": 0.9 },
      scalesY: { "g:0:0:0:1": 0.8 },
      order: ["g:0:0:1:1", "g:0:0:0:1", "g:0:0:0:0"],
      // A piece that is turned, and the back of another one that is not.
      backs: { "g:0:0:0:0": "g:0:0:1:1", "g:0:0:1:1": "g:0:0:0:1" },
    };
    expect(editsAfterRekey(edits, moves)).toEqual({
      turns: { "f:0:0:0": 90, "g:0:0:1:1": 180 },
      scales: { "f:0:0:1": 0.9 },
      scalesY: { "f:0:0:1": 0.8 },
      order: ["g:0:0:1:1", "f:0:0:1", "f:0:0:0"],
      backs: { "f:0:0:0": "g:0:0:1:1", "g:0:0:1:1": "f:0:0:1" },
    });
  });

  it("leaves edits without a height map without one, and nothing to move alone", () => {
    expect(editsAfterRekey(NO_EDITS, moves)).toEqual(NO_EDITS);
    expect(editsAfterRekey({ ...NO_EDITS, turns: { "f:0:0:5": 90 } }, moves).turns).toEqual({ "f:0:0:5": 90 });
  });
});

describe("a deleted freeform piece and the height scale", () => {
  it("renumbers the later pieces' height scales with their width scales", () => {
    const edits = {
      ...NO_EDITS,
      scales: { [cardIdKey(freeformCardId(0, 0, 2))]: 0.9 },
      scalesY: { [cardIdKey(freeformCardId(0, 0, 2))]: 0.8, [cardIdKey(freeformCardId(0, 0, 1))]: 0.7 },
    };
    const after = editsAfterDelete(edits, 0, 0, 1);
    expect(after.scales).toEqual({ "f:0:0:1": 0.9 });
    expect(after.scalesY).toEqual({ "f:0:0:1": 0.8 });
  });
});
