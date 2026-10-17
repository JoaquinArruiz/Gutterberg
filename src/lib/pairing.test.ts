import { describe, expect, it } from "vitest";
import { type CardId, cardIdKey, freeformCardId, gridCardId } from "./card";
import { NO_EDITS } from "./card-edits";
import {
  applyPairing,
  DEFAULT_PAIRING,
  lonePiece,
  type PairingOptions,
  pairingFromSides,
  pairPieces,
  pieceName,
} from "./pairing";
import type { Card } from "./sheet-api";

const piece = (id: CardId): Card => ({
  id,
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const g = (page: number, row: number, column: number, doc = 0) => piece(gridCardId(doc, page, row, column));
const f = (page: number, index: number, doc = 0) => piece(freeformCardId(doc, page, index));
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

describe("pairing pages with several grids", () => {
  /** Grid number `n` of `page`, rows x columns. */
  const grid = (pg: number, n: number, rows: number, columns: number) =>
    Array.from({ length: rows * columns }, (_, i) => piece(gridCardId(0, pg, Math.floor(i / columns), i % columns, n)));
  const at = (pg: number, n: number, row: number, column: number) => k(piece(gridCardId(0, pg, row, column, n)));

  it("pairs each grid with the same grid of the backs' page, mirrored within that grid", () => {
    const cards = [...grid(0, 0, 2, 3), ...grid(0, 1, 1, 2), ...grid(1, 0, 2, 3), ...grid(1, 1, 1, 2)];
    const { backs, unpaired } = pairPieces(cards, opts({ rule: "alternating", mirrored: true }));
    expect(backs[at(0, 0, 0, 0)]).toBe(at(1, 0, 0, 2));
    // The second grid has two columns of its own: its first piece meets its second.
    expect(backs[at(0, 1, 0, 0)]).toBe(at(1, 1, 0, 1));
    expect(backs[at(0, 1, 0, 1)]).toBe(at(1, 1, 0, 0));
    expect(Object.keys(backs)).toHaveLength(8);
    expect(unpaired).toEqual([]);
  });

  it("folds each grid of a gutterfold page on its own", () => {
    const cards = [...grid(0, 0, 1, 4), ...grid(0, 1, 1, 2)];
    const { backs } = pairPieces(cards, opts({ rule: "beside", split: "columns" }));
    expect(backs).toEqual({
      [at(0, 0, 0, 0)]: at(0, 0, 0, 3),
      [at(0, 0, 0, 1)]: at(0, 0, 0, 2),
      [at(0, 1, 0, 0)]: at(0, 1, 0, 1),
    });
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

describe("pairing with the backs in another PDF", () => {
  const fronts = [...page(0, 1, 2), ...page(1, 1, 2)];
  const backsPdf = [g(0, 0, 0, 1), g(0, 0, 1, 1), g(1, 0, 0, 1), g(1, 0, 1, 1)];
  const other = (o: Partial<PairingOptions> = {}) => opts({ rule: "otherPdf", backsDocument: 1, ...o });

  it("pairs page n of the fronts with page n of the backs, mirrored", () => {
    const { backs, unpaired } = pairPieces([...fronts, ...backsPdf], other());
    expect(backs).toEqual({
      [k(g(0, 0, 0))]: k(g(0, 0, 1, 1)),
      [k(g(0, 0, 1))]: k(g(0, 0, 0, 1)),
      [k(g(1, 0, 0))]: k(g(1, 0, 1, 1)),
      [k(g(1, 0, 1))]: k(g(1, 0, 0, 1)),
    });
    expect(unpaired).toEqual([]);
  });

  it("or straight across, and freeform pieces by their order", () => {
    const { backs } = pairPieces(
      [...fronts, ...backsPdf, f(2, 0), f(2, 1), f(2, 0, 1), f(2, 1, 1)],
      other({ mirrored: false }),
    );
    expect(backs[k(g(0, 0, 0))]).toBe(k(g(0, 0, 0, 1)));
    expect(backs[k(f(2, 1))]).toBe(k(f(2, 1, 1)));
  });

  it("matches the page numbers in the file, so a page with no pieces does not shift the rest", () => {
    const { backs } = pairPieces([g(0, 0, 0), g(2, 0, 0), g(2, 0, 0, 1), g(3, 0, 0, 1)], other());
    expect(backs).toEqual({ [k(g(2, 0, 0))]: k(g(2, 0, 0, 1)) });
  });

  it("leaves unmatched pieces unpaired: missing pages, other rows, and backs with no front", () => {
    const { backs, unpaired } = pairPieces([...page(0, 2, 1), g(1, 0, 0), g(0, 0, 0, 1), g(3, 0, 0, 1)], other());
    expect(backs).toEqual({ [k(g(0, 0, 0))]: k(g(0, 0, 0, 1)) });
    expect(unpaired.sort()).toEqual([k(g(0, 1, 0)), k(g(1, 0, 0)), k(g(3, 0, 0, 1))].sort());
  });

  it("pairs every other PDF with the backs one", () => {
    const { backs } = pairPieces([g(0, 0, 0), g(0, 0, 0, 2), g(0, 0, 0, 1), g(1, 0, 0, 1)], other({ mirrored: false }));
    expect(backs).toEqual({ [k(g(0, 0, 0))]: k(g(0, 0, 0, 1)), [k(g(0, 0, 0, 2))]: k(g(0, 0, 0, 1)) });
  });

  it("pairs nothing without a backs PDF", () => {
    const { backs, unpaired } = pairPieces([...fronts, ...backsPdf], other({ backsDocument: null }));
    expect(backs).toEqual({});
    expect(unpaired).toHaveLength(8);
  });

  it("offers a backs PDF of one piece as the common back of every front", () => {
    const cards = [...fronts, g(0, 0, 0, 1)];
    expect(lonePiece(cards, 1)).toBe(k(g(0, 0, 0, 1)));
    expect(lonePiece(cards, 0)).toBeNull();
    const shared = pairPieces(cards, other());
    expect(shared).toEqual({ backs: {}, unpaired: [], commonBack: k(g(0, 0, 0, 1)) });
    // Or page by page, when that is chosen.
    const byPage = pairPieces(cards, other({ commonBack: false, mirrored: false }));
    expect(byPage.backs).toEqual({ [k(g(0, 0, 0))]: k(g(0, 0, 0, 1)) });
    expect(byPage.commonBack).toBeUndefined();
  });

  it("turns the common back with the others when the backs are upside down", () => {
    const after = applyPairing(NO_EDITS, { backs: {}, unpaired: [], commonBack: "g:1:0:0:0" }, true);
    expect(after.turns).toEqual({ "g:1:0:0:0": 180 });
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

describe("pairing from an AI answer", () => {
  const keys = ["a", "b", "c", "d", "e"];
  const sides = [
    { index: 0, side: "front" as const, back: 3, upside_down: false },
    { index: 1, side: "front" as const, back: 3, upside_down: false },
    { index: 2, side: "front" as const, back: null, upside_down: false },
    { index: 3, side: "back" as const, back: null, upside_down: true },
    { index: 4, side: "back" as const, back: null, upside_down: false },
  ];

  it("gives fronts the back the answer names, shared or not, and keeps every back out of the fronts", () => {
    const pairing = pairingFromSides(keys, sides);
    expect(pairing.backs).toEqual({ a: "d", b: "d" });
    expect(pairing.backPieces).toEqual(["d", "e"]);
    expect(pairing.turned).toEqual(["d"]);
    // A front with no back, and nothing else: a back is not "left without a pair".
    expect(pairing.unpaired).toEqual(["c"]);
  });

  it("turns only the backs the answer found upside down, whatever the option says", () => {
    const after = applyPairing(NO_EDITS, pairingFromSides(keys, sides), false);
    expect(after.turns).toEqual({ d: 180 });
    expect(after.backs).toEqual({ a: "d", b: "d" });
  });

  it("names a piece by where it is, in words the model reads", () => {
    expect(pieceName(g(2, 0, 1), null)).toBe("page 3, grid 1, row 1, column 2");
    expect(pieceName(f(0, 1, 1), "B")).toBe("PDF B, page 1, piece 2 marked by hand");
  });
});
