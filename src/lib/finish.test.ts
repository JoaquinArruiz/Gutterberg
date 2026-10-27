import { describe, expect, it } from "vitest";
import { backsWithoutDocument, editsAfterDelete, NO_EDITS, setBacks } from "./card-edits";
import { cleanColor, cleanFinish, DEFAULT_FINISH, type Finish, finishingOn, MAX_BLEED_MM } from "./finish";

describe("finish settings", () => {
  it("start with everything off", () => {
    expect(finishingOn(DEFAULT_FINISH)).toBe(false);
    expect(DEFAULT_FINISH.marks).toEqual({
      style: "off",
      line: "solid",
      widthMm: 0.25,
      color: "#000000",
      lengthMm: 3,
      offsetMm: 1,
      onBacks: false,
      innerCrosses: false,
    });
    expect(DEFAULT_FINISH.bleed).toEqual({ mm: 0, source: "mirror" });
    expect(DEFAULT_FINISH.duplex).toEqual({
      on: false,
      layout: "duplex",
      fold: "vertical",
      foldGapMm: 0,
      cutApart: false,
      backUpsideDown: null,
      flip: "long",
      offsetXMm: 0,
      offsetYMm: 0,
      commonBack: null,
    });
    expect(DEFAULT_FINISH.background).toEqual({ sheet: null, pieces: null });
    expect(finishingOn({ ...DEFAULT_FINISH, bleed: { mm: 1, source: "mirror" } })).toBe(true);
    expect(finishingOn({ ...DEFAULT_FINISH, background: { sheet: "#000000", pieces: null } })).toBe(true);
  });

  it("are pulled back into what the engine accepts", () => {
    const wild: Finish = {
      marks: {
        style: "ticks",
        line: "dotted",
        widthMm: 50,
        color: "red",
        lengthMm: 0,
        offsetMm: -3,
        onBacks: true,
        innerCrosses: true,
      },
      bleed: { mm: 99, source: "source" },
      duplex: {
        ...DEFAULT_FINISH.duplex,
        on: true,
        flip: "short",
        offsetXMm: -40,
        offsetYMm: Number.NaN,
        commonBack: "not a key",
      },
      background: { sheet: "#00FF00", pieces: "green" },
    };
    const clean = cleanFinish(wild);
    expect(clean.marks).toEqual({
      style: "ticks",
      line: "dotted",
      widthMm: 2,
      color: "#000000",
      lengthMm: 1,
      offsetMm: 0,
      onBacks: true,
      innerCrosses: true,
    });
    expect(clean.bleed).toEqual({ mm: MAX_BLEED_MM, source: "source" });
    expect(clean.duplex).toEqual({
      ...DEFAULT_FINISH.duplex,
      on: true,
      flip: "short",
      offsetXMm: -10,
      commonBack: null,
    });
    expect(clean.background).toEqual({ sheet: "#00ff00", pieces: null });
    expect(cleanColor("#ABCDEF")).toBe("#abcdef");
    expect(cleanColor("#abc")).toBe("#000000");
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
