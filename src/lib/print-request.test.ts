import { describe, expect, it } from "vitest";
import type { OutputSettings } from "../stores/layout-store";
import { cardIdKey, freeformCardId, gridCardId } from "./card";
import { NO_EDITS } from "./card-edits";
import { defaultGroups, setSkipped, updateGridGroup } from "./document-layout";
import {
  DEFAULT_PLAN,
  effectiveGrid,
  type PrintPlan,
  plannerRequired,
  printProject,
  requestedCopies,
} from "./print-request";
import { toProject } from "./project";
import type { Card } from "./sheet-api";

// The request itself is built in Rust from the project (`card_core::print_request`, tested against the requests
// this file used to build in crates/card-core/tests/print_request.rs). What is left here is what the UI sends it and
// what the Print inspector shows.

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
const groups = setSkipped(
  updateGridGroup(defaultGroups(3), 0, (g) => ({ ...g, grids: [{ ...g.grids[0], selection: sel }] })),
  0,
  true,
);
const plan = (p: Partial<PrintPlan> = {}): PrintPlan => ({ ...DEFAULT_PLAN, ...p });
const freeform = { 1: [{ center: { x: 0.5, y: 0.5 }, width: 0.1, height: 0.2, angle_deg: 5 }] };

describe("what the UI sends the Rust planner", () => {
  it("is the project as it is saved: the same documents, output, edits and plan", () => {
    const edits = { ...NO_EDITS, turns: { [cardIdKey(cards[0].id)]: 90 as const } };
    const p = plan({ mode: "custom", quantities: { [cardIdKey(cards[1].id)]: 2 } });
    // The layout store holds more than the output settings; only those are sent.
    const store = { ...output, activeGrid: 0, groups: [] };
    const sent = printProject(p, [{ id: 0, pages, groups, freeform }], store, edits);
    const saved = toProject({
      documents: [
        { kind: "pdf", id: 0, path: "/a.pdf", hash: "0".repeat(64), pageCount: 3, groups, freeform, viewedPage: 0 },
      ],
      activeId: 0,
      output,
      edits,
      plan: p,
    });
    expect(sent).toEqual({
      documents: saved.documents.map(({ id, kind, groups, freeform }) => ({ id, kind, groups, freeform })),
      output: saved.output,
      edits: saved.edits,
      plan: saved.plan,
    });
    expect(
      printProject(p, [{ id: 3, pages, groups, freeform: {}, images: true }], output, edits).documents[0].kind,
    ).toBe("images");
  });
});

describe("the sheet grid the Print inspector shows", () => {
  it("only offers 'same as source' for the default plan", () => {
    expect(effectiveGrid(plan())).toBe("same");
    expect(effectiveGrid(plan({ mode: "custom" }))).toBe("auto");
    expect(effectiveGrid(plan({ autoFill: true }))).toBe("auto");
    expect(effectiveGrid(plan({ mode: "custom", sheetGrid: "custom" }))).toBe("custom");
  });

  it("needs the planner for freeform cards, which 'same as source' would drop", () => {
    const withFreeform = [...cards, { ...cards[0], id: freeformCardId(0, 1, 0) }];
    expect(plannerRequired(cards, NO_EDITS)).toBe(false);
    expect(plannerRequired(withFreeform, NO_EDITS)).toBe(true);
    expect(effectiveGrid(plan(), true)).toBe("auto");
  });

  it("needs the planner for pieces of images, whose source page is only one piece", () => {
    expect(plannerRequired(cards, NO_EDITS, new Set([7]))).toBe(false);
    expect(plannerRequired(cards, NO_EDITS, new Set([cards[0].id.document_id]))).toBe(true);
  });

  it("needs the planner for cards turned, resized or reordered", () => {
    const k = cardIdKey(cards[2].id);
    expect(plannerRequired(cards, { ...NO_EDITS, turns: { [k]: 90 } })).toBe(true);
    expect(plannerRequired(cards, { ...NO_EDITS, scales: { [k]: 0.98 } })).toBe(true);
    expect(plannerRequired(cards, { ...NO_EDITS, order: [k] })).toBe(true);
  });
});

describe("the summary line", () => {
  it("counts the copies the plan asks for", () => {
    const q = { [cardIdKey(cards[1].id)]: 4 };
    expect(requestedCopies(plan({ mode: "custom", quantities: q }), cards)).toBe(4);
    expect(requestedCopies(plan(), cards)).toBe(3);
  });
});
