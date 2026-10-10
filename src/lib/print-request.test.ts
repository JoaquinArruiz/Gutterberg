import { describe, expect, it } from "vitest";
import fixtureText from "../../crates/card-core/tests/data/print_request.json?raw";
import type { OutputSettings } from "../stores/layout-store";
import { cardIdKey, freeformCardId, gridCardId } from "./card";
import { NO_EDITS } from "./card-edits";
import { defaultGroups, type PageGroup, setSkipped, updateGridGroup } from "./document-layout";
import {
  buildPrintRequest,
  DEFAULT_PLAN,
  effectiveGrid,
  type PrintPlan,
  plannerRequired,
  planSettings,
  requestedCopies,
  toRustGroups,
} from "./print-request";
import type { Card } from "./sheet-api";

const output: OutputSettings = {
  gapXMm: 3,
  gapYMm: 4,
  gapLinked: false,
  pageMode: "same",
  orientation: "portrait",
  customWidthMm: 210,
  customHeightMm: 297,
  margins: { top: 1, right: 2, bottom: 3, left: 4 },
};
const pages = [
  { width_pt: 595, height_pt: 842 },
  { width_pt: 595, height_pt: 842 },
  { width_pt: 595, height_pt: 842 },
];
const sel = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const card = (page: number, column: number): Card => ({
  id: gridCardId(0, page, 0, column),
  source: { center: { x: 0, y: 0 }, width: 1, height: 1, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cards = [card(1, 0), card(1, 1), card(1, 2)];
const card1 = { center: { x: 0.5, y: 0.5 }, width: 0.1, height: 0.2, angle_deg: 5 };
const groups = setSkipped(
  updateGridGroup(defaultGroups(3), 0, (g) => ({ ...g, selection: sel })),
  0,
  true,
);
const plan = (p: Partial<PrintPlan> = {}): PrintPlan => ({ ...DEFAULT_PLAN, ...p });
const docs = [{ id: 0, pages, groups, freeform: {} }];

describe("toRustGroups", () => {
  it("keeps skips, gives grids the output settings and leaves out groups with no region", () => {
    const out = toRustGroups(groups, pages, output);
    expect(out.map((g) => g.kind)).toEqual(["skip", "grid"]);
    const grid = out[1];
    if (grid.kind !== "grid") throw new Error("not a grid");
    expect(grid.pages).toEqual({ first: 1, last: 2 });
    expect(grid.grid.bounds).toEqual(sel);
    expect(grid.grid.gap_y_mm).toBe(4);
    expect(toRustGroups(defaultGroups(3), pages, output)).toEqual([]);
  });

  it("converts freeform cards from the page's normalized units to points", () => {
    const own = { 2: [{ center: { x: 0.5, y: 0.5 }, width: 0.1, height: 0.2, angle_deg: 5 }] };
    const g = toRustGroups(defaultGroups(3), pages, output, own).find((x) => x.kind === "freeform");
    if (g?.kind !== "freeform") throw new Error("not freeform");
    expect(g.pages).toEqual({ first: 2, last: 2 });
    expect(g.cards[0]).toEqual({ center: { x: 297.5, y: 421 }, width: 59.5, height: 168.4, angle_deg: 5 });
  });

  it("puts a page's freeform cards right after its grid cards, so cards stay in page order", () => {
    const own = { 2: [card1], 1: [card1] };
    const out = toRustGroups(groups, pages, output, own);
    // Pages 1 and 2 share one grid, split around the pages that have freeform cards.
    expect(out.map((g) => [g.kind, g.pages.first, g.pages.last])).toEqual([
      ["skip", 0, 0],
      ["grid", 1, 1],
      ["freeform", 1, 1],
      ["grid", 2, 2],
      ["freeform", 2, 2],
    ]);
  });

  it("keeps freeform cards of a page with no grid region, and drops those of a skipped page", () => {
    const own = { 0: [card1], 2: [card1] };
    const out = toRustGroups(groups, pages, output, own);
    expect(out.filter((g) => g.kind === "freeform").map((g) => g.pages.first)).toEqual([2]);
    const onlyFree = toRustGroups(defaultGroups(3), pages, output, { 1: [card1] });
    expect(onlyFree.map((g) => g.kind)).toEqual(["freeform"]);
  });
});

describe("cards the user turned, resized or reordered", () => {
  const key = (i: number) => cardIdKey(cards[i].id);

  it("lists every card in the user's order with its turn and scale, even in 'all cards' mode", () => {
    const edits = {
      turns: { [key(0)]: 90 as const },
      scales: { [key(2)]: 0.98 },
      order: [key(2), key(0), key(1)],
      backs: {},
    };
    const req = buildPrintRequest(plan(), cards, docs, output, edits);
    expect(req.settings.map((s) => [cardIdKey(s.id), s.quantity, s.turn, s.scale])).toEqual([
      [key(2), 1, 0, 0.98],
      [key(0), 1, 90, 1],
      [key(1), 1, 0, 1],
    ]);
    // The planner has to lay out cards that differ, so "same as source" gives way to Auto.
    expect(req.layout.kind).toBe("grid");
  });

  it("keeps the order in custom mode too, with the quantities attached to the right cards", () => {
    const p = plan({ mode: "custom", quantities: { [key(0)]: 2, [key(1)]: 3 } });
    const edits = { turns: {}, scales: {}, order: [key(1), key(0)], backs: {} };
    const req = buildPrintRequest(p, cards, docs, output, edits);
    expect(req.settings.map((s) => [cardIdKey(s.id), s.quantity])).toEqual([
      [key(1), 3],
      [key(0), 2],
      [key(2), 0],
    ]);
  });

  it("changes nothing when no card is edited", () => {
    const plain = buildPrintRequest(plan(), cards, docs, output);
    expect(buildPrintRequest(plan(), cards, docs, output, { turns: {}, scales: {}, order: [], backs: {} })).toEqual(
      plain,
    );
    expect(plain.layout).toEqual({ kind: "same_as_source" });
  });

  it("needs the planner for freeform cards, which 'same as source' would drop", () => {
    const withFreeform = [...cards, { ...cards[0], id: freeformCardId(0, 1, 0) }];
    expect(plannerRequired(cards, { turns: {}, scales: {}, order: [], backs: {} })).toBe(false);
    expect(plannerRequired(withFreeform, { turns: {}, scales: {}, order: [], backs: {} })).toBe(true);
    expect(effectiveGrid(plan(), true)).toBe("auto");
  });

  it("needs the planner for pieces of images, whose source page is only one piece", () => {
    const none = { turns: {}, scales: {}, order: [], backs: {} };
    expect(plannerRequired(cards, none, new Set([7]))).toBe(false);
    expect(plannerRequired(cards, none, new Set([cards[0].id.document_id]))).toBe(true);
    const imageDocs = docs.map((d) => ({ ...d, images: true }));
    expect(buildPrintRequest(plan(), cards, imageDocs, output).layout.kind).toBe("grid");
  });
});

describe("the plan", () => {
  it("is every card once, each source page on its own sheet, by default", () => {
    const req = buildPrintRequest(plan(), cards, docs, output);
    expect(req.layout).toEqual({ kind: "same_as_source" });
    expect(req.settings).toEqual([]);
    expect(req.options).toEqual({ order: "grouped", group_by_size: true, auto_fill: false });
  });

  it("only offers 'same as source' for the default plan", () => {
    expect(effectiveGrid(plan())).toBe("same");
    expect(effectiveGrid(plan({ mode: "custom" }))).toBe("auto");
    expect(effectiveGrid(plan({ autoFill: true }))).toBe("auto");
    expect(effectiveGrid(plan({ mode: "custom", sheetGrid: "custom" }))).toBe("custom");
  });

  it("asks for a quantity of every card in custom mode, zero for the ones not chosen", () => {
    const q = { [cardIdKey(cards[1].id)]: 4 };
    const settings = planSettings(plan({ mode: "custom", quantities: q }), cards);
    expect(settings.map((s) => s.quantity)).toEqual([0, 4, 0]);
    expect(settings[1]).toMatchObject({ id: cards[1].id, turn: 0, scale: 1 });
    expect(requestedCopies(plan({ mode: "custom", quantities: q }), cards)).toBe(4);
    expect(requestedCopies(plan(), cards)).toBe(3);
  });

  it("sends a piece's own height to the engine, and nothing extra for pieces without one", () => {
    const k = cardIdKey(cards[1].id);
    const edits = { turns: {}, scales: { [k]: 1 }, scalesY: { [k]: 1.1 }, order: [], backs: {} };
    const req = buildPrintRequest(plan({ mode: "custom", quantities: { [k]: 2 } }), cards, docs, output, edits);
    expect(req.settings[1]).toMatchObject({ id: cards[1].id, quantity: 2, scale: 1, scale_y: 1.1 });
    expect("scale_y" in req.settings[0]).toBe(false);
  });

  it("describes the sheet from the output settings", () => {
    const p = plan({ mode: "custom", sheetGrid: "custom", rows: 2, columns: 5, order: "interleaved", autoFill: true });
    const req = buildPrintRequest(p, cards, docs, { ...output, pageMode: "a4", orientation: "landscape" });
    if (req.layout.kind !== "grid") throw new Error("not a grid layout");
    const { spec } = req.layout;
    expect([spec.rows, spec.columns]).toEqual([2, 5]);
    expect(spec.page.kind).toBe("size");
    if (spec.page.kind === "size") expect(spec.page.width_pt).toBeCloseTo((297 / 25.4) * 72, 6);
    expect(spec.margins).toEqual({ top_mm: 1, right_mm: 2, bottom_mm: 3, left_mm: 4 });
    expect([spec.gap_x_mm, spec.gap_y_mm]).toEqual([3, 4]);
    expect(req.options).toEqual({ order: "interleaved", group_by_size: true, auto_fill: true });
  });

  it("leaves the rows and columns to the planner on Auto, and follows the source page or fits it", () => {
    const auto = buildPrintRequest(plan({ mode: "custom" }), cards, docs, output);
    if (auto.layout.kind !== "grid") throw new Error("not a grid layout");
    expect([auto.layout.spec.rows, auto.layout.spec.columns]).toEqual([null, null]);
    expect(auto.layout.spec.page).toEqual({ kind: "same_as_source" });
    const fit = buildPrintRequest(plan({ mode: "custom" }), cards, docs, { ...output, pageMode: "fit" });
    if (fit.layout.kind !== "grid") throw new Error("not a grid layout");
    expect(fit.layout.spec.page).toEqual({ kind: "fit" });
  });
});

describe("the IPC contract with the Rust planner", () => {
  // The same JSON file is read by crates/card-core/tests/sheets.rs, which deserialises it into the
  // Rust types and plans from it: if either side changes a field name or shape, one of them fails.
  const fixture = JSON.parse(fixtureText);

  it("builds exactly the request the Rust test reads", () => {
    const a4 = { width_pt: 595.2756, height_pt: 841.8898 };
    const groups: PageGroup[] = [
      { kind: "skip", pages: { first: 0, last: 0 } },
      {
        kind: "grid",
        pages: { first: 1, last: 1 },
        grid: { rows: 1, columns: 3, sourceGapXMm: 0, sourceGapYMm: 0, sourceGapLinked: true },
        selection: { x: 0.1, y: 0.2, width: 0.8, height: 0.3 },
      },
      { kind: "skip", pages: { first: 2, last: 2 } },
    ];
    const three = [0, 1, 2].map((c) => ({
      id: gridCardId(0, 1, 0, c),
      source: { center: { x: 100 + c * 100, y: 200 }, width: 100, height: 130, angle_deg: 0 },
      scale: 1,
      turn: 0 as const,
    }));
    const p = plan({
      mode: "custom",
      quantities: { [cardIdKey(three[0].id)]: 4, [cardIdKey(three[2].id)]: 1 },
      autoFill: true,
      order: "interleaved",
      sheetGrid: "custom",
      rows: 2,
      columns: 3,
      finish: {
        marks: { style: "ticks", widthMm: 0.5, color: "#ff0000", lengthMm: 4, offsetMm: 1.5 },
        bleed: { mm: 2, source: "mirror" },
        duplex: { on: true, flip: "short", offsetXMm: 0.5, offsetYMm: -0.5, commonBack: cardIdKey(three[0].id) },
      },
    });
    const settings: OutputSettings = {
      gapXMm: 3,
      gapYMm: 4,
      gapLinked: false,
      pageMode: "a4",
      orientation: "portrait",
      customWidthMm: 210,
      customHeightMm: 297,
      margins: { top: 1, right: 2, bottom: 3, left: 4 },
    };
    const backs = { ...NO_EDITS, backs: { [cardIdKey(three[1].id)]: cardIdKey(three[2].id) } };
    const req = buildPrintRequest(p, three, [{ id: 0, pages: [a4, a4, a4], groups, freeform: {} }], settings, backs);
    expect(JSON.parse(JSON.stringify(req))).toEqual(fixture);
  });
});
