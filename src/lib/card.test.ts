import { describe, expect, it } from "vitest";
import { CardIdSchema, cardIdKey, DEFAULT_DOCUMENT_ID, freeformCardId, gridCardId, OrientedRectSchema } from "./card";
import { orientedFromPoints, orientedToPoints } from "./coordinates";

describe("CardId", () => {
  it("matches the JSON Rust serialises", () => {
    // The same literals as card_core::card's serialisation test.
    const grid = { kind: "grid", document_id: 0, page_index: 2, row: 1, column: 0 };
    expect(CardIdSchema.parse(grid)).toEqual(gridCardId(DEFAULT_DOCUMENT_ID, 2, 1, 0));
    const free = { kind: "freeform", document_id: 3, page_index: 0, index: 7 };
    expect(CardIdSchema.parse(free)).toEqual(freeformCardId(3, 0, 7));
  });

  it("rejects an unknown kind", () => {
    expect(() => CardIdSchema.parse({ kind: "other", document_id: 0, page_index: 0 })).toThrow();
  });

  it("has a distinct key per card, document and kind", () => {
    const keys = [
      gridCardId(0, 0, 0, 0),
      gridCardId(1, 0, 0, 0),
      gridCardId(0, 1, 0, 0),
      gridCardId(0, 0, 1, 0),
      gridCardId(0, 0, 0, 1),
      freeformCardId(0, 0, 0),
      freeformCardId(0, 0, 1),
    ].map(cardIdKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("OrientedRect", () => {
  const page = { width_pt: 600, height_pt: 800 };
  const r = { center: { x: 0.5, y: 0.25 }, width: 0.1, height: 0.2, angle_deg: 7 };

  it("matches the JSON Rust serialises", () => {
    expect(OrientedRectSchema.parse(r)).toEqual(r);
    expect(() => OrientedRectSchema.parse({ ...r, angle_deg: undefined })).toThrow();
  });

  it("converts normalized to points and back, keeping the angle", () => {
    const p = orientedToPoints(r, page);
    expect(p).toEqual({ center: { x: 300, y: 200 }, width: 60, height: 160, angle_deg: 7 });
    const back = orientedFromPoints(p, page);
    expect(back.center.x).toBeCloseTo(r.center.x, 12);
    expect(back.center.y).toBeCloseTo(r.center.y, 12);
    expect(back.width).toBeCloseTo(r.width, 12);
    expect(back.height).toBeCloseTo(r.height, 12);
    expect(back.angle_deg).toBe(7);
  });
});
