import { describe, expect, it } from "vitest";
import {
  applyGridTo,
  clampRange,
  DEFAULT_GROUP_GRID,
  defaultGroups,
  type GridGroup,
  groupAt,
  includedPages,
  isSkipped,
  type PageGroup,
  pageBadge,
  pagesOfSameSize,
  patchGrid,
  rangeLabel,
  runsOf,
  setSkipped,
  updateGridGroup,
} from "./document-layout";

const sel = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const shape = (groups: PageGroup[]) => groups.map((g) => `${g.kind}:${g.pages.first}-${g.pages.last}`);

/** Every page is covered exactly once, in order. */
function expectCovering(groups: PageGroup[], total: number) {
  let next = 0;
  for (const g of groups) {
    expect(g.pages.first).toBe(next);
    expect(g.pages.last).toBeGreaterThanOrEqual(g.pages.first);
    next = g.pages.last + 1;
  }
  expect(next).toBe(total);
}

describe("defaultGroups", () => {
  it("is one grid group over all pages", () => {
    const g = defaultGroups(5);
    expect(shape(g)).toEqual(["grid:0-4"]);
    expect((g[0] as GridGroup).selection).toBeNull();
  });

  it("has no groups for an empty document", () => {
    expect(defaultGroups(0)).toEqual([]);
  });

  it("does not share the grid object between documents", () => {
    const a = defaultGroups(2)[0] as GridGroup;
    a.grid.rows = 9;
    expect(DEFAULT_GROUP_GRID.rows).toBe(3);
  });
});

describe("setSkipped", () => {
  it("skips the first page, leaving the rest as one group", () => {
    const g = setSkipped(defaultGroups(6), 0, true);
    expect(shape(g)).toEqual(["skip:0-0", "grid:1-5"]);
    expect(isSkipped(g, 0)).toBe(true);
    expect(isSkipped(g, 1)).toBe(false);
  });

  it("splits a section when a page in the middle is skipped", () => {
    const g = setSkipped(defaultGroups(6), 3, true);
    expect(shape(g)).toEqual(["grid:0-2", "skip:3-3", "grid:4-5"]);
    expectCovering(g, 6);
  });

  it("merges neighbouring skipped pages", () => {
    let g = setSkipped(defaultGroups(6), 0, true);
    g = setSkipped(g, 1, true);
    expect(shape(g)).toEqual(["skip:0-1", "grid:2-5"]);
  });

  it("includes a page again by joining the grid group before it", () => {
    let g = setSkipped(defaultGroups(6), 0, true);
    g = setSkipped(g, 0, false);
    expect(shape(g)).toEqual(["grid:0-5"]);
  });

  it("includes a page by joining the group after it when nothing is before", () => {
    let g = setSkipped(defaultGroups(4), 0, true);
    g = setSkipped(g, 1, true);
    g = setSkipped(g, 0, false);
    expect(shape(g)).toEqual(["grid:0-0", "skip:1-1", "grid:2-3"]);
  });

  it("rejoins the halves of a section when the page between them is included again", () => {
    let g = setSkipped(defaultGroups(6), 3, true);
    g = setSkipped(g, 3, false);
    expect(shape(g)).toEqual(["grid:0-5"]);
  });

  it("does not rejoin sections that have different grids", () => {
    let g = setSkipped(defaultGroups(6), 3, true);
    g = updateGridGroup(g, 4, (x) => ({ ...x, grid: patchGrid(x.grid, { rows: 2, columns: 2 }) }));
    g = setSkipped(g, 3, false);
    expect(shape(g)).toEqual(["grid:0-3", "grid:4-5"]);
  });

  it("gives a page its own default grid when every page is skipped", () => {
    let g = setSkipped(defaultGroups(1), 0, true);
    expect(shape(g)).toEqual(["skip:0-0"]);
    g = setSkipped(g, 0, false);
    expect(shape(g)).toEqual(["grid:0-0"]);
    expect((g[0] as GridGroup).grid).toEqual(DEFAULT_GROUP_GRID);
  });

  it("includes one page out of a run of skipped pages", () => {
    let g = defaultGroups(5);
    for (const p of [1, 2, 3]) g = setSkipped(g, p, true);
    g = setSkipped(g, 2, false);
    expect(shape(g)).toEqual(["grid:0-0", "skip:1-1", "grid:2-2", "skip:3-3", "grid:4-4"]);
    expectCovering(g, 5);
  });

  it("does nothing when the page already is in that state", () => {
    const g = defaultGroups(3);
    expect(setSkipped(g, 1, false)).toBe(g);
    expect(setSkipped(g, 9, true)).toBe(g);
  });
});

describe("updateGridGroup", () => {
  it("edits the whole group the page belongs to", () => {
    let g = setSkipped(defaultGroups(5), 0, true);
    g = updateGridGroup(g, 2, (x) => ({ ...x, selection: sel }));
    expect((groupAt(g, 1) as GridGroup).selection).toEqual(sel);
    expect((groupAt(g, 4) as GridGroup).selection).toEqual(sel);
  });

  it("leaves skipped pages alone", () => {
    const g = setSkipped(defaultGroups(3), 0, true);
    expect(updateGridGroup(g, 0, (x) => ({ ...x, selection: sel }))).toBe(g);
  });
});

describe("applyGridTo", () => {
  const withSection = () => {
    const g = updateGridGroup(defaultGroups(8), 0, (x) => ({ ...x, selection: sel }));
    return g;
  };

  it("copies the grid to one page as its own group", () => {
    const g = applyGridTo(withSection(), 0, [4]);
    expect(shape(g)).toEqual(["grid:0-3", "grid:4-4", "grid:5-7"]);
    // Separate groups: editing one leaves the others alone.
    const edited = updateGridGroup(g, 4, (x) => ({ ...x, grid: patchGrid(x.grid, { rows: 2 }) }));
    expect((groupAt(edited, 0) as GridGroup).grid.rows).toBe(3);
    expect((groupAt(edited, 4) as GridGroup).grid.rows).toBe(2);
    expect((groupAt(edited, 4) as GridGroup).selection).toEqual(sel);
  });

  it("copies the grid to a range of pages as one group", () => {
    const g = applyGridTo(withSection(), 0, [4, 5, 6]);
    expect(shape(g)).toEqual(["grid:0-3", "grid:4-6", "grid:7-7"]);
    expectCovering(g, 8);
  });

  it("copies to the pages of a non-contiguous set, replacing skips", () => {
    let g = setSkipped(withSection(), 3, true);
    g = applyGridTo(g, 0, [3, 5]);
    expect(isSkipped(g, 3)).toBe(false);
    expect(shape(g)).toEqual(["grid:0-2", "grid:3-3", "grid:4-4", "grid:5-5", "grid:6-7"]);
    expectCovering(g, 8);
  });

  it("copies to every page", () => {
    const g = applyGridTo(withSection(), 2, [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shape(g)).toEqual(["grid:0-7"]);
  });

  it("does not alias the source's grid or region", () => {
    const g = applyGridTo(withSection(), 0, [5]);
    const a = groupAt(g, 0) as GridGroup;
    const b = groupAt(g, 5) as GridGroup;
    expect(b.grid).not.toBe(a.grid);
    expect(b.selection).not.toBe(a.selection);
  });

  it("needs a grid group as the source", () => {
    const g = setSkipped(defaultGroups(3), 0, true);
    expect(applyGridTo(g, 0, [1])).toBe(g);
  });
});

describe("pages and ranges", () => {
  it("lists the included pages", () => {
    let g = setSkipped(defaultGroups(5), 0, true);
    g = setSkipped(g, 3, true);
    expect(includedPages(g)).toEqual([1, 2, 4]);
  });

  it("finds consecutive runs", () => {
    expect(runsOf([5, 1, 2, 3, 3, 7])).toEqual([
      { first: 1, last: 3 },
      { first: 5, last: 5 },
      { first: 7, last: 7 },
    ]);
    expect(runsOf([])).toEqual([]);
  });

  it("finds pages of the same size, leaving skipped ones out", () => {
    const a4 = { width_pt: 595, height_pt: 842 };
    const letter = { width_pt: 612, height_pt: 792 };
    const sizes = [a4, a4, letter, a4, { width_pt: 595.2, height_pt: 841.8 }];
    const g = setSkipped(defaultGroups(5), 3, true);
    expect(pagesOfSameSize(g, sizes, 0)).toEqual([0, 1, 4]);
    expect(pagesOfSameSize(g, sizes, 2)).toEqual([2]);
    // The page itself is always included, even when skipped.
    expect(pagesOfSameSize(g, sizes, 3)).toEqual([0, 1, 3, 4]);
  });

  it("clamps and orders a range", () => {
    expect(clampRange(8, 2, 5)).toEqual({ first: 2, last: 4 });
    expect(clampRange(-3, 1, 5)).toEqual({ first: 0, last: 1 });
  });

  it("labels ranges with 1-based page numbers", () => {
    expect(rangeLabel({ first: 0, last: 0 })).toBe("Page 1");
    expect(rangeLabel({ first: 2, last: 8 })).toBe("Pages 3–9");
  });
});

describe("pageBadge", () => {
  it("is null for pages in the viewed group", () => {
    expect(pageBadge(defaultGroups(4), 2, 0)).toBeNull();
  });

  it("names the grid or the skip of another group", () => {
    let g = setSkipped(defaultGroups(5), 0, true);
    g = updateGridGroup(g, 1, (x) => ({ ...x, selection: sel }));
    g = applyGridTo(g, 1, [4]);
    g = updateGridGroup(g, 4, (x) => ({ ...x, grid: patchGrid(x.grid, { rows: 2, columns: 4 }) }));
    expect(pageBadge(g, 0, 1)).toBe("Skipped");
    expect(pageBadge(g, 4, 1)).toBe("2×4");
    expect(pageBadge(g, 2, 1)).toBeNull();
    expect(pageBadge(g, 1, 4)).toBe("3×3");
  });

  it("flags a group with no region drawn yet", () => {
    const g = setSkipped(defaultGroups(3), 1, true);
    expect(pageBadge(g, 2, 1)).toBe("No region");
  });
});

describe("patchGrid", () => {
  it("clamps counts and gaps", () => {
    const g = patchGrid(DEFAULT_GROUP_GRID, { rows: 0, columns: 99, sourceGapXMm: -4 });
    expect(g.rows).toBe(1);
    expect(g.columns).toBe(30);
    expect(g.sourceGapXMm).toBe(0);
  });

  it("makes a linked vertical gap follow the horizontal one", () => {
    const g = patchGrid(DEFAULT_GROUP_GRID, { sourceGapXMm: 2 });
    expect([g.sourceGapXMm, g.sourceGapYMm]).toEqual([2, 2]);
  });

  it("edits the vertical gap alone when unlinked", () => {
    let g = patchGrid(DEFAULT_GROUP_GRID, { sourceGapLinked: false });
    g = patchGrid(g, { sourceGapXMm: 2 });
    g = patchGrid(g, { sourceGapYMm: 5 });
    expect([g.sourceGapXMm, g.sourceGapYMm]).toEqual([2, 5]);
  });

  it("snaps the vertical gap to the horizontal one when linking", () => {
    let g = patchGrid(DEFAULT_GROUP_GRID, { sourceGapLinked: false, sourceGapXMm: 2, sourceGapYMm: 5 });
    g = patchGrid(g, { sourceGapLinked: true });
    expect(g.sourceGapYMm).toBe(2);
  });
});
