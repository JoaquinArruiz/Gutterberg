import { describe, expect, it } from "vitest";
import { cardIdKey, freeformCardId, gridCardId } from "./card";
import {
  applyEdits,
  type CardEdits,
  clampScale,
  editsAfterDelete,
  finalSizePt,
  formatCardSize,
  hasCardEdits,
  keyAfterDelete,
  moveCards,
  NO_EDITS,
  orientCards,
  scaleCards,
  scaleForSize,
  turnCards,
} from "./card-edits";
import type { Card } from "./sheet-api";
import { mmToPt } from "./units";

const mk = (id: Card["id"], wMm = 63, hMm = 88): Card => ({
  id,
  source: { center: { x: 100, y: 100 }, width: mmToPt(wMm), height: mmToPt(hMm), angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const grid = [0, 1, 2, 3].map((c) => mk(gridCardId(0, 0, 0, c)));
const keys = grid.map((c) => cardIdKey(c.id));
const order = (cards: Card[]) => cards.map((c) => keys.indexOf(cardIdKey(c.id)));

describe("applyEdits", () => {
  it("is the page order with nothing edited", () => {
    expect(applyEdits(grid, NO_EDITS)).toEqual(grid);
    expect(hasCardEdits(grid, NO_EDITS)).toBe(false);
  });

  it("applies turn and scale to the card they belong to", () => {
    const edits: CardEdits = { ...NO_EDITS, turns: { [keys[1]]: 90 }, scales: { [keys[2]]: 0.5 } };
    const out = applyEdits(grid, edits);
    expect(out.map((c) => c.turn)).toEqual([0, 90, 0, 0]);
    expect(out.map((c) => c.scale)).toEqual([1, 1, 0.5, 1]);
    expect(hasCardEdits(grid, edits)).toBe(true);
  });

  it("follows a custom order, with unlisted cards after it in page order", () => {
    const edits: CardEdits = { ...NO_EDITS, order: [keys[3], keys[1]] };
    expect(order(applyEdits(grid, edits))).toEqual([3, 1, 0, 2]);
    expect(hasCardEdits(grid, edits)).toBe(true);
    // An order that lists the page order is no edit at all.
    expect(hasCardEdits(grid, { ...NO_EDITS, order: keys })).toBe(false);
  });

  it("ignores edits of cards that no longer exist", () => {
    const edits: CardEdits = { turns: { "g:0:9:9:9": 90 }, scales: {}, order: ["g:0:9:9:9", keys[2]] };
    expect(order(applyEdits(grid, edits))).toEqual([2, 0, 1, 3]);
    expect(hasCardEdits(grid, { ...NO_EDITS, turns: { "g:0:9:9:9": 90 } })).toBe(false);
  });
});

describe("turning", () => {
  it("adds quarter turns, wraps, and forgets a full turn", () => {
    let e = turnCards(NO_EDITS, grid, [keys[0]], 90);
    expect(e.turns[keys[0]]).toBe(90);
    e = turnCards(e, applyEdits(grid, e), [keys[0]], 270);
    expect(e.turns).toEqual({});
    e = turnCards(e, grid, [keys[0], keys[1]], -90);
    expect(e.turns).toEqual({ [keys[0]]: 270, [keys[1]]: 270 });
  });

  it("makes cards portrait or landscape with a quarter turn only where needed", () => {
    const mixed = [
      mk(freeformCardId(0, 0, 0), 63, 88),
      mk(freeformCardId(0, 0, 1), 88, 63),
      mk(freeformCardId(0, 0, 2), 70, 70),
    ];
    const ks = mixed.map((c) => cardIdKey(c.id));
    const land = orientCards(NO_EDITS, mixed, ks, "landscape");
    expect(land.turns).toEqual({ [ks[0]]: 90 });
    const port = orientCards(NO_EDITS, mixed, ks, "portrait");
    expect(port.turns).toEqual({ [ks[1]]: 90 });
    // Already-turned cards count as they print: a turned portrait card is landscape.
    const turnedOnce = applyEdits(mixed, land);
    expect(finalSizePt(turnedOnce[0]).width).toBeGreaterThan(finalSizePt(turnedOnce[0]).height);
    expect(orientCards(land, turnedOnce, ks, "landscape")).toEqual(land);
  });

  it("turns a card back rather than on, so it keeps facing as the page has it", () => {
    const wide = mk(freeformCardId(0, 0, 0), 88, 63);
    const k = cardIdKey(wide.id);
    const portrait = orientCards(NO_EDITS, [wide], [k], "portrait");
    expect(portrait.turns).toEqual({ [k]: 90 });
    // Landscape again: back to no turn, not on to 180 (upside down).
    expect(orientCards(portrait, applyEdits([wide], portrait), [k], "landscape").turns).toEqual({});
    // From 270 a quarter turn on is the shortest way round.
    const edits: CardEdits = { ...NO_EDITS, turns: { [k]: 270 } };
    expect(orientCards(edits, applyEdits([wide], edits), [k], "landscape").turns).toEqual({});
  });
});

describe("scaling", () => {
  it("stores a scale, and 100% clears it", () => {
    const e = scaleCards(NO_EDITS, [keys[0], keys[1]], 0.98);
    expect(e.scales).toEqual({ [keys[0]]: 0.98, [keys[1]]: 0.98 });
    expect(scaleCards(e, [keys[0]], 1).scales).toEqual({ [keys[1]]: 0.98 });
  });

  it("keeps a scale within sane limits", () => {
    expect(clampScale(0)).toBe(0.1);
    expect(clampScale(100)).toBe(5);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("finds the scale that sets a real size: 64 x 89.4 mm to 63 x 88", () => {
    const c = mk(freeformCardId(0, 0, 0), 64, 89.4);
    const s = scaleForSize(c.source, "width", 63);
    const scaled = { ...c, scale: s };
    expect(finalSizePt(scaled).width).toBeCloseTo(mmToPt(63), 6);
    expect(finalSizePt(scaled).height).toBeCloseTo(mmToPt(88.0), 0);
    expect(formatCardSize(scaled, "mm")).toBe("63.0 × 88.0 mm (98.4%)");
  });

  it("shows other units, and an unscaled card at 100%", () => {
    expect(formatCardSize(mk(freeformCardId(0, 0, 0), 63.5, 88.9), "in")).toBe("2.50 × 3.50 in (100.0%)");
  });
});

describe("moveCards", () => {
  it("moves a card before or after another", () => {
    expect(order(applyEdits(grid, moveCards(NO_EDITS, grid, [keys[3]], keys[0], false)))).toEqual([3, 0, 1, 2]);
    expect(order(applyEdits(grid, moveCards(NO_EDITS, grid, [keys[0]], keys[3], true)))).toEqual([1, 2, 3, 0]);
  });

  it("moves a selection together, keeping its own order", () => {
    const e = moveCards(NO_EDITS, grid, [keys[2], keys[0]], keys[3], false);
    expect(order(applyEdits(grid, e))).toEqual([1, 0, 2, 3]);
  });

  it("builds on the order already chosen", () => {
    const first = moveCards(NO_EDITS, grid, [keys[3]], keys[0], false);
    const second = moveCards(first, applyEdits(grid, first), [keys[1]], keys[3], false);
    expect(order(applyEdits(grid, second))).toEqual([1, 3, 0, 2]);
  });

  it("does nothing when dropped on itself or on an unknown card", () => {
    expect(moveCards(NO_EDITS, grid, [keys[1], keys[2]], keys[2], false)).toBe(NO_EDITS);
    expect(moveCards(NO_EDITS, grid, [keys[1]], "nope", false)).toBe(NO_EDITS);
  });
});

describe("deleting a freeform card", () => {
  it("renumbers the later cards of that page only", () => {
    expect(keyAfterDelete("f:0:2:1", 0, 2, 1)).toBeNull();
    expect(keyAfterDelete("f:0:2:3", 0, 2, 1)).toBe("f:0:2:2");
    expect(keyAfterDelete("f:0:2:0", 0, 2, 1)).toBe("f:0:2:0");
    expect(keyAfterDelete("f:0:5:3", 0, 2, 1)).toBe("f:0:5:3");
    expect(keyAfterDelete("g:0:2:0:3", 0, 2, 1)).toBe("g:0:2:0:3");
  });

  it("leaves the cards of other PDFs alone", () => {
    expect(keyAfterDelete("f:1:2:1", 0, 2, 1)).toBe("f:1:2:1");
    expect(keyAfterDelete("f:1:2:3", 0, 2, 1)).toBe("f:1:2:3");
    expect(keyAfterDelete("f:1:2:3", 1, 2, 1)).toBe("f:1:2:2");
  });

  it("moves its turn, scale and place in the order along with the cards", () => {
    const e: CardEdits = {
      turns: { "f:0:0:0": 90, "f:0:0:1": 180, "f:0:0:2": 270, "f:1:0:2": 90 },
      scales: { "f:0:0:1": 0.9, "f:0:0:2": 0.8 },
      order: ["f:0:0:2", "f:1:0:2", "f:0:0:1", "f:0:0:0"],
    };
    expect(editsAfterDelete(e, 0, 0, 1)).toEqual({
      turns: { "f:0:0:0": 90, "f:0:0:1": 270, "f:1:0:2": 90 },
      scales: { "f:0:0:1": 0.8 },
      order: ["f:0:0:1", "f:1:0:2", "f:0:0:0"],
    });
  });
});
