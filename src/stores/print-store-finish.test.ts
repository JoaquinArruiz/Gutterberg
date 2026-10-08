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

describe("cut marks, bleed and duplex in the print store", () => {
  it("start off and are part of the plan", () => {
    expect(planOf(st()).finish).toEqual({
      marks: { style: "off", widthMm: 0.25, color: "#000000", lengthMm: 3, offsetMm: 1 },
      bleed: { mm: 0, source: "mirror" },
      duplex: { on: false, flip: "long", offsetXMm: 0, offsetYMm: 0, commonBack: null },
    });
  });

  it("merge each change in and keep the numbers inside what the engine accepts", () => {
    st().setMarks({ style: "gaps", widthMm: 7 });
    st().setBleed({ mm: 2 });
    st().setBleed({ source: "source" });
    st().setDuplex({ on: true, offsetXMm: -50 });
    expect(st().finish.marks).toMatchObject({ style: "gaps", widthMm: 2, lengthMm: 3 });
    expect(st().finish.bleed).toEqual({ mm: 2, source: "source" });
    expect(st().finish.duplex).toMatchObject({ on: true, flip: "long", offsetXMm: -10 });
  });

  it("are reset with the plan and loaded with it", () => {
    st().setBleed({ mm: 1 });
    st().reset();
    expect(st().finish.bleed.mm).toBe(0);
    const plan = planOf(st());
    st().loadPlan({ ...plan, finish: { ...plan.finish, bleed: { mm: 3, source: "mirror" } } });
    expect(st().finish.bleed.mm).toBe(3);
  });

  it("forget the common back when its PDF leaves the project", () => {
    st().setDuplex({ commonBack: keys[1] });
    st().forgetDocument(1);
    expect(st().finish.duplex.commonBack).toBe(keys[1]);
    st().forgetDocument(0);
    expect(st().finish.duplex.commonBack).toBeNull();
  });

  it("stop picking a back when the plan is reset", () => {
    expect(st().pickingBack).toBe(false);
    st().setPickingBack(true);
    expect(st().pickingBack).toBe(true);
    st().reset();
    expect(st().pickingBack).toBe(false);
  });
});
