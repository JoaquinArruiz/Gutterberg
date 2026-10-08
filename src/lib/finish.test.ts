import { describe, expect, it } from "vitest";
import { backsWithoutDocument, editsAfterDelete, NO_EDITS, setBacks } from "./card-edits";
import {
  cleanColor,
  cleanFinish,
  DEFAULT_FINISH,
  type Finish,
  finishingOn,
  finishingPayload,
  MAX_BLEED_MM,
  parseCardKey,
} from "./finish";

describe("finish settings", () => {
  it("start with everything off", () => {
    expect(finishingOn(DEFAULT_FINISH)).toBe(false);
    expect(DEFAULT_FINISH.marks).toEqual({ style: "off", widthMm: 0.25, color: "#000000", lengthMm: 3, offsetMm: 1 });
    expect(DEFAULT_FINISH.bleed).toEqual({ mm: 0, source: "mirror" });
    expect(DEFAULT_FINISH.duplex).toEqual({
      on: false,
      flip: "long",
      offsetXMm: 0,
      offsetYMm: 0,
      commonBack: null,
    });
    expect(finishingOn({ ...DEFAULT_FINISH, bleed: { mm: 1, source: "mirror" } })).toBe(true);
  });

  it("are pulled back into what the engine accepts", () => {
    const wild: Finish = {
      marks: { style: "ticks", widthMm: 50, color: "red", lengthMm: 0, offsetMm: -3 },
      bleed: { mm: 99, source: "source" },
      duplex: { on: true, flip: "short", offsetXMm: -40, offsetYMm: Number.NaN, commonBack: "not a key" },
    };
    const clean = cleanFinish(wild);
    expect(clean.marks).toEqual({ style: "ticks", widthMm: 2, color: "#000000", lengthMm: 1, offsetMm: 0 });
    expect(clean.bleed).toEqual({ mm: MAX_BLEED_MM, source: "source" });
    expect(clean.duplex).toEqual({ on: true, flip: "short", offsetXMm: -10, offsetYMm: 0, commonBack: null });
    expect(cleanColor("#ABCDEF")).toBe("#abcdef");
    expect(cleanColor("#abc")).toBe("#000000");
  });
});

describe("parseCardKey", () => {
  it("reads grid and freeform keys and nothing else", () => {
    expect(parseCardKey("g:1:2:3:4")).toEqual({ kind: "grid", document_id: 1, page_index: 2, row: 3, column: 4 });
    expect(parseCardKey("f:0:5:6")).toEqual({ kind: "freeform", document_id: 0, page_index: 5, index: 6 });
    for (const bad of ["", "g:1:2:3", "f:1:2:3:4", "g:a:b:c:d", "x:1:2:3", "g:-1:0:0:0"]) {
      expect(parseCardKey(bad)).toBeNull();
    }
  });
});

describe("finishingPayload", () => {
  const known = new Set(["g:0:0:0:0", "g:0:0:0:1", "g:0:0:1:0"]);
  const finish: Finish = {
    marks: { style: "gaps", widthMm: 0.5, color: "#ff0000", lengthMm: 4, offsetMm: 2 },
    bleed: { mm: 2, source: "mirror" },
    duplex: { on: true, flip: "long", offsetXMm: 1, offsetYMm: -1, commonBack: "g:0:0:1:0" },
  };

  it("uses the engine's snake_case names and card ids", () => {
    const p = finishingPayload(finish, { "g:0:0:0:0": "g:0:0:0:1" }, known);
    expect(p.options.marks).toEqual({ style: "gaps", width_mm: 0.5, color: "#ff0000", length_mm: 4, offset_mm: 2 });
    expect(p.options.duplex.common_back).toEqual({ kind: "grid", document_id: 0, page_index: 0, row: 1, column: 0 });
    expect(p.options.duplex.offset_y_mm).toBe(-1);
    expect(p.backs).toEqual([
      {
        card: { kind: "grid", document_id: 0, page_index: 0, row: 0, column: 0 },
        back: { kind: "grid", document_id: 0, page_index: 0, row: 0, column: 1 },
      },
    ]);
  });

  it("leaves out a back that points at a piece that is gone", () => {
    const p = finishingPayload(
      { ...finish, duplex: { ...finish.duplex, commonBack: "g:0:9:9:9" } },
      { "g:0:0:0:0": "g:0:7:7:7", "g:0:6:6:6": "g:0:0:0:1" },
      known,
    );
    expect(p.backs).toEqual([]);
    expect(p.options.duplex.common_back).toBeNull();
  });
});

describe("backs of pieces", () => {
  it("are set and cleared for a selection, and a piece is never its own back", () => {
    const set = setBacks(NO_EDITS, ["g:0:0:0:0", "g:0:0:0:1"], "g:0:0:1:0");
    expect(set.backs).toEqual({ "g:0:0:0:0": "g:0:0:1:0", "g:0:0:0:1": "g:0:0:1:0" });
    expect(setBacks(set, ["g:0:0:0:0"], null).backs).toEqual({ "g:0:0:0:1": "g:0:0:1:0" });
    expect(setBacks(set, ["g:0:0:1:0"], "g:0:0:1:0").backs).toEqual(set.backs);
  });

  it("go with the PDF they belong to, as a front or as a back", () => {
    const backs = { "g:0:0:0:0": "g:1:0:0:0", "g:1:0:0:1": "g:1:0:0:2", "g:0:0:0:2": "g:0:0:0:3" };
    expect(backsWithoutDocument(backs, 1)).toEqual({ "g:0:0:0:2": "g:0:0:0:3" });
  });

  it("follow a deleted freeform piece: pairs that name it go, later pieces are renumbered", () => {
    const edits = {
      ...NO_EDITS,
      backs: { "f:0:0:0": "f:0:0:2", "f:0:0:1": "g:0:0:0:0", "f:0:0:2": "f:0:0:0", "g:0:0:0:0": "f:0:0:1" },
    };
    expect(editsAfterDelete(edits, 0, 0, 1).backs).toEqual({ "f:0:0:0": "f:0:0:1", "f:0:0:1": "f:0:0:0" });
  });
});
