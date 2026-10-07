import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUT } from "../stores/layout-store";
import { NO_EDITS } from "./card-edits";
import { applyGridTo, defaultGroups, setSkipped, updateGridGroup } from "./document-layout";
import { DEFAULT_PLAN } from "./print-request";
import {
  fromProject,
  groupsCoverPages,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectState,
  parseProject,
  projectSignature,
  toProject,
} from "./project";

const hash = (n: number) => n.toString(16).padStart(64, "0");
const sel = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const tilted = { center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: 7 };

/** A project that uses everything a file stores: groups, a skipped page, freeform pieces, edits, a plan. */
function state(): ProjectState {
  let groups = updateGridGroup(defaultGroups(4), 0, (g) => ({ ...g, selection: sel }));
  groups = applyGridTo(groups, 0, [1]);
  groups = setSkipped(groups, 3, true);
  return {
    documents: [
      { id: 0, path: "/games/a.pdf", hash: hash(1), pageCount: 4, groups, freeform: { 2: [tilted] }, viewedPage: 2 },
      {
        id: 3,
        path: "/games/b.pdf",
        hash: hash(2),
        pageCount: 1,
        groups: defaultGroups(1),
        freeform: {},
        viewedPage: 0,
      },
    ],
    activeId: 3,
    output: {
      ...DEFAULT_OUTPUT,
      gapXMm: 2.5,
      gapYMm: 2.5,
      pageMode: "a4",
      margins: { top: 5, right: 4, bottom: 3, left: 2 },
    },
    edits: { turns: { "f:0:2:0": 90 }, scales: { "g:3:0:0:0": 0.98 }, order: ["g:3:0:0:0", "f:0:2:0"] },
    plan: {
      ...DEFAULT_PLAN,
      mode: "custom",
      quantities: { "g:0:0:0:0": 3, "g:3:0:0:1": 1 },
      order: "interleaved",
      sheetGrid: "custom",
      rows: 2,
      columns: 4,
    },
  };
}

/** What a file holds: the envelope Rust writes first, then the content. */
const file = (s: ProjectState) =>
  JSON.parse(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...toProject(s) }));

describe("the project file", () => {
  it("brings back everything it was made from: groups, freeform pieces, turns, scales, order, plan, output", () => {
    const before = state();
    expect(fromProject(parseProject(file(before)))).toEqual(before);
  });

  it("holds each PDF's path, hash, page count and layout, not the PDFs", () => {
    const f = file(state());
    expect(
      f.documents.map((d: { id: number; path: string; hash: string; pageCount: number }) => [
        d.id,
        d.path,
        d.hash,
        d.pageCount,
      ]),
    ).toEqual([
      [0, "/games/a.pdf", hash(1), 4],
      [3, "/games/b.pdf", hash(2), 1],
    ]);
    expect(f.documents[0].freeform["2"]).toEqual([tilted]);
    expect(f.documents[0].groups.map((g: { kind: string }) => g.kind)).toEqual(["grid", "grid", "grid", "skip"]);
    expect(f.activeDocument).toBe(3);
    expect(JSON.stringify(f)).not.toContain("%PDF");
  });

  it("is refused when it is not shaped like a project", () => {
    const f = file(state());
    expect(() => parseProject({ ...f, format: "other" })).toThrow();
    expect(() => parseProject({ ...f, version: 2 })).toThrow();
    expect(() => parseProject({ ...f, documents: [] })).toThrow();
    expect(() => parseProject({ ...f, activeDocument: 9 })).toThrow();
    expect(() => parseProject({ ...f, documents: [f.documents[0], f.documents[0]] })).toThrow();
    expect(() => parseProject({ ...f, plan: { ...f.plan, mode: "everything" } })).toThrow();
    expect(() => parseProject({ ...f, output: { ...f.output, gapXMm: "3" } })).toThrow();
    const noHash = structuredClone(f);
    noHash.documents[0].hash = "abc";
    expect(() => parseProject(noHash)).toThrow();
    const badGroup = structuredClone(f);
    badGroup.documents[0].groups[0].kind = "freeform";
    expect(() => parseProject(badGroup)).toThrow();
    const badKey = structuredClone(f);
    badKey.documents[0].freeform = { page: [tilted] };
    expect(() => parseProject(badKey)).toThrow();
  });

  it("pulls values a hand edit pushed out of range back to what the UI allows", () => {
    const f = file(state());
    f.output.gapXMm = 9000;
    f.output.gapLinked = true;
    f.output.margins.top = -4;
    f.plan.quantities = { "g:0:0:0:0": 5000, "g:0:0:0:1": 0 };
    f.plan.rows = 400;
    f.edits.scales = { "g:0:0:0:0": 40, "not a key": 2 };
    f.edits.order = ["g:0:0:0:0", "junk"];
    f.documents[0].groups[0].grid.rows = 99;
    const back = fromProject(parseProject(f));
    expect(back.output.gapXMm).toBe(50);
    expect(back.output.gapYMm).toBe(50);
    expect(back.output.margins.top).toBe(0);
    expect(back.plan.quantities).toEqual({ "g:0:0:0:0": 99 });
    expect(back.plan.rows).toBe(30);
    expect(back.edits.scales).toEqual({ "g:0:0:0:0": 5 });
    expect(back.edits.order).toEqual(["g:0:0:0:0"]);
    const group = back.documents[0].groups[0];
    expect(group.kind === "grid" && group.grid.rows).toBe(30);
  });
});

describe("the signature", () => {
  it("is the same for the same content, and changes with any edit", () => {
    const base = projectSignature(state());
    expect(projectSignature(state())).toBe(base);
    const edited = state();
    edited.plan = { ...edited.plan, quantities: { ...edited.plan.quantities, "g:0:0:0:2": 1 } };
    expect(projectSignature(edited)).not.toBe(base);
    const moved = state();
    moved.documents[0] = { ...moved.documents[0], path: "/elsewhere/a.pdf" };
    expect(projectSignature(moved)).not.toBe(base);
    const edits = state();
    edits.edits = NO_EDITS;
    expect(projectSignature(edits)).not.toBe(base);
  });

  it("ignores which page is being viewed: turning pages is not editing", () => {
    const turned = state();
    turned.documents[0] = { ...turned.documents[0], viewedPage: 0 };
    expect(projectSignature(turned)).toBe(projectSignature(state()));
  });
});

describe("groupsCoverPages", () => {
  it("wants every page covered once, in order", () => {
    expect(groupsCoverPages(defaultGroups(4), 4)).toBe(true);
    expect(groupsCoverPages(defaultGroups(4), 5)).toBe(false);
    expect(groupsCoverPages(defaultGroups(4), 3)).toBe(false);
    expect(groupsCoverPages(setSkipped(defaultGroups(4), 1, true), 4)).toBe(true);
    expect(groupsCoverPages([], 0)).toBe(true);
    const gap = defaultGroups(4).map((g) => ({ ...g, pages: { first: 1, last: 3 } }));
    expect(groupsCoverPages(gap, 4)).toBe(false);
  });
});
