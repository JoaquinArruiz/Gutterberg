import { describe, expect, it } from "vitest";
import { type CardId, cardIdKey, freeformCardId, gridCardId } from "./card";
import { NO_EDITS } from "./card-edits";
import { applyPairing, DEFAULT_PAIRING, type PairingOptions, pairPieces } from "./pairing";
import type { Card } from "./sheet-api";

const piece = (id: CardId): Card => ({
  id,
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const g = (page: number, row: number, column: number, doc = 0) => piece(gridCardId(doc, page, row, column));
const f = (page: number, index: number) => piece(freeformCardId(0, page, index));
const k = (c: Card) => cardIdKey(c.id);
/** A rows x columns grid of pieces on `page`. */
const page = (n: number, rows: number, columns: number) =>
  Array.from({ length: rows * columns }, (_, i) => g(n, Math.floor(i / columns), i % columns));
const opts = (o: Partial<PairingOptions>): PairingOptions => ({ ...DEFAULT_PAIRING, ...o });

describe("pairing by alternating pages", () => {
  const cards = [...page(0, 3, 3), ...page(1, 3, 3)];

  it("pairs each front with the back on the next page, its columns mirrored", () => {
    const { backs, unpaired } = pairPieces(cards, opts({ rule: "alternating", mirrored: true }));
    expect(Object.keys(backs)).toHaveLength(9);
    expect(backs[k(g(0, 0, 0))]).toBe(k(g(1, 0, 2)));
    expect(backs[k(g(0, 1, 1))]).toBe(k(g(1, 1, 1)));
    expect(backs[k(g(0, 2, 2))]).toBe(k(g(1, 2, 0)));
    expect(unpaired).toEqual([]);
  });

  it("or straight across when the backs are not mirrored", () => {
    const { backs } = pairPieces(cards, opts({ rule: "alternating", mirrored: false }));
    expect(backs[k(g(0, 0, 0))]).toBe(k(g(1, 0, 0)));
    expect(backs[k(g(0, 2, 1))]).toBe(k(g(1, 2, 1)));
  });

  it("goes page by page, each PDF on its own, and lists what is left", () => {
    const more = [...cards, ...page(2, 3, 3), ...page(3, 2, 3), g(4, 0, 0), g(0, 0, 0, 1), g(1, 0, 0, 1)];
    const { backs, unpaired } = pairPieces(more, opts({ rule: "alternating", mirrored: false }));
    expect(backs[k(g(2, 1, 2))]).toBe(k(g(3, 1, 2)));
    expect(backs[k(g(0, 0, 0, 1))]).toBe(k(g(1, 0, 0, 1)));
    // Page 3 has one row fewer than page 2; page 5 is missing, so page 4 has no backs.
    expect(unpaired.sort()).toEqual([k(g(2, 2, 0)), k(g(2, 2, 1)), k(g(2, 2, 2)), k(g(4, 0, 0))].sort());
  });

  it("matches freeform pieces by their order", () => {
    const { backs, unpaired } = pairPieces([f(0, 0), f(0, 1), f(0, 2), f(1, 0), f(1, 1)], opts({}));
    expect(backs).toEqual({ [k(f(0, 0))]: k(f(1, 0)), [k(f(0, 1))]: k(f(1, 1)) });
    expect(unpaired).toEqual([k(f(0, 2))]);
  });
});

describe("pairing with the backs after the fronts", () => {
  it("pairs page i of the first half with page i of the second", () => {
    const cards = [...page(0, 1, 2), ...page(1, 1, 2), ...page(2, 1, 2), ...page(3, 1, 2)];
    const { backs } = pairPieces(cards, opts({ rule: "afterFronts", mirrored: true }));
    expect(backs).toEqual({
      [k(g(0, 0, 0))]: k(g(2, 0, 1)),
      [k(g(0, 0, 1))]: k(g(2, 0, 0)),
      [k(g(1, 0, 0))]: k(g(3, 0, 1)),
      [k(g(1, 0, 1))]: k(g(3, 0, 0)),
    });
  });

  it("leaves the last page out when there is an odd number", () => {
    const cards = [...page(0, 1, 1), ...page(1, 1, 1), ...page(2, 1, 1)];
    const { backs, unpaired } = pairPieces(cards, opts({ rule: "afterFronts" }));
    expect(backs).toEqual({ [k(g(0, 0, 0))]: k(g(1, 0, 0)) });
    expect(unpaired).toEqual([k(g(2, 0, 0))]);
  });
});

describe("pairing beside each other on the page", () => {
  it("pairs the left half with the right, each piece with the one it meets when folded", () => {
    const { backs, unpaired } = pairPieces(page(0, 2, 4), opts({ rule: "beside", split: "columns" }));
    expect(backs).toEqual({
      [k(g(0, 0, 0))]: k(g(0, 0, 3)),
      [k(g(0, 0, 1))]: k(g(0, 0, 2)),
      [k(g(0, 1, 0))]: k(g(0, 1, 3)),
      [k(g(0, 1, 1))]: k(g(0, 1, 2)),
    });
    expect(unpaired).toEqual([]);
  });

  it("or the top half with the bottom, and leaves a middle row or column out", () => {
    const { backs, unpaired } = pairPieces(page(0, 3, 2), opts({ rule: "beside", split: "rows" }));
    expect(backs).toEqual({ [k(g(0, 0, 0))]: k(g(0, 2, 0)), [k(g(0, 0, 1))]: k(g(0, 2, 1)) });
    expect(unpaired).toEqual([k(g(0, 1, 0)), k(g(0, 1, 1))]);
  });

  it("matches freeform pieces first half with second half", () => {
    const { backs } = pairPieces([f(0, 0), f(0, 1), f(0, 2), f(0, 3)], opts({ rule: "beside" }));
    expect(backs).toEqual({ [k(f(0, 0))]: k(f(0, 2)), [k(f(0, 1))]: k(f(0, 3)) });
  });
});

describe("applying a pairing", () => {
  const pairing = { backs: { "g:0:0:0:0": "g:0:1:0:0" }, unpaired: [] };

  it("sets the backs, turns them when upside down, and keeps other pieces' backs", () => {
    const before = { ...NO_EDITS, backs: { "g:0:5:0:0": "g:0:6:0:0", "g:0:1:0:0": "g:0:7:0:0" } };
    const after = applyPairing(before, pairing, true);
    expect(after.backs).toEqual({ "g:0:5:0:0": "g:0:6:0:0", "g:0:0:0:0": "g:0:1:0:0" });
    expect(after.turns).toEqual({ "g:0:1:0:0": 180 });
  });

  it("clears a back's turn when the backs are upright", () => {
    const after = applyPairing({ ...NO_EDITS, turns: { "g:0:1:0:0": 180, "g:0:0:0:0": 90 } }, pairing, false);
    expect(after.turns).toEqual({ "g:0:0:0:0": 90 });
  });
});
