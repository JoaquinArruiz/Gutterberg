import { describe, expect, it } from "vitest";
import {
  activeRegion,
  addFolder,
  addGrid,
  applyGridTo,
  clampRange,
  cleanGridName,
  clearGridRegion,
  DEFAULT_GROUP_GRID,
  defaultGroups,
  deleteGrid,
  drawnGrids,
  folderGrids,
  folderNames,
  type GridGroup,
  gridGroupAt,
  gridList,
  groupAt,
  hasRegion,
  includedPages,
  isRemoved,
  isSkipped,
  MAX_GRID_NAME,
  MAX_GRIDS,
  moveInGridList,
  newFolderName,
  newGridRegion,
  type PageGroup,
  pageBadge,
  pagesOfSameSize,
  patchGrid,
  rangeLabel,
  removedPages,
  removePage,
  renameFolder,
  runsOf,
  setSkipped,
  shownPage,
  updateGrid,
  updateGridGroup,
  withLook,
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
    expect((g[0] as GridGroup).grids[0].selection).toBeNull();
  });

  it("has no groups for an empty document", () => {
    expect(defaultGroups(0)).toEqual([]);
  });

  it("does not share the grid object between documents", () => {
    const a = defaultGroups(2)[0] as GridGroup;
    a.grids[0].grid.rows = 9;
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
    g = updateGridGroup(g, 4, (x) => ({
      ...x,
      grids: [{ ...x.grids[0], grid: patchGrid(x.grids[0].grid, { rows: 2, columns: 2 }) }],
    }));
    g = setSkipped(g, 3, false);
    expect(shape(g)).toEqual(["grid:0-3", "grid:4-5"]);
  });

  it("gives a page its own default grid when every page is skipped", () => {
    let g = setSkipped(defaultGroups(1), 0, true);
    expect(shape(g)).toEqual(["skip:0-0"]);
    g = setSkipped(g, 0, false);
    expect(shape(g)).toEqual(["grid:0-0"]);
    expect((g[0] as GridGroup).grids[0].grid).toEqual(DEFAULT_GROUP_GRID);
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
    g = updateGridGroup(g, 2, (x) => ({ ...x, grids: [{ ...x.grids[0], selection: sel }] }));
    expect((groupAt(g, 1) as GridGroup).grids[0].selection).toEqual(sel);
    expect((groupAt(g, 4) as GridGroup).grids[0].selection).toEqual(sel);
  });

  it("leaves skipped pages alone", () => {
    const g = setSkipped(defaultGroups(3), 0, true);
    expect(updateGridGroup(g, 0, (x) => ({ ...x, grids: [{ ...x.grids[0], selection: sel }] }))).toBe(g);
  });
});

describe("applyGridTo", () => {
  const withSection = () => {
    const g = updateGridGroup(defaultGroups(8), 0, (x) => ({ ...x, grids: [{ ...x.grids[0], selection: sel }] }));
    return g;
  };

  it("copies the grid to one page as its own group", () => {
    const g = applyGridTo(withSection(), 0, [4]);
    expect(shape(g)).toEqual(["grid:0-3", "grid:4-4", "grid:5-7"]);
    // Separate groups: editing one leaves the others alone.
    const edited = updateGridGroup(g, 4, (x) => ({
      ...x,
      grids: [{ ...x.grids[0], grid: patchGrid(x.grids[0].grid, { rows: 2 }) }],
    }));
    expect((groupAt(edited, 0) as GridGroup).grids[0].grid.rows).toBe(3);
    expect((groupAt(edited, 4) as GridGroup).grids[0].grid.rows).toBe(2);
    expect((groupAt(edited, 4) as GridGroup).grids[0].selection).toEqual(sel);
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
    expect(b.grids[0].grid).not.toBe(a.grids[0].grid);
    expect(b.grids[0].selection).not.toBe(a.grids[0].selection);
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
    g = updateGridGroup(g, 1, (x) => ({ ...x, grids: [{ ...x.grids[0], selection: sel }] }));
    g = applyGridTo(g, 1, [4]);
    g = updateGridGroup(g, 4, (x) => ({
      ...x,
      grids: [{ ...x.grids[0], grid: patchGrid(x.grids[0].grid, { rows: 2, columns: 4 }) }],
    }));
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

describe("several grids in a group", () => {
  const sel = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
  const other = { x: 0.1, y: 0.6, width: 0.6, height: 0.2 };
  const twoGrids = () => {
    let g = updateGrid(defaultGroups(4), 0, 0, (r) => ({ ...r, selection: sel }));
    g = addGrid(g, 0);
    return updateGrid(g, 0, 1, (r) => ({ grid: patchGrid(r.grid, { rows: 1, columns: 4 }), selection: other }));
  };

  it("adds a grid with the default settings and no region, up to the limit", () => {
    let g = defaultGroups(2);
    for (let i = 0; i < MAX_GRIDS + 2; i++) g = addGrid(g, 1);
    const group = g[0] as GridGroup;
    expect(group.grids).toHaveLength(MAX_GRIDS);
    expect(group.grids[1]).toEqual({ grid: DEFAULT_GROUP_GRID, selection: null });
  });

  it("deletes a grid and moves the later ones up, but always keeps one", () => {
    const g = deleteGrid(twoGrids(), 3, 0);
    expect((g[0] as GridGroup).grids.map((r) => r.selection)).toEqual([other]);
    const last = deleteGrid(g, 0, 0);
    expect((last[0] as GridGroup).grids).toEqual([{ grid: expect.objectContaining({ rows: 1 }), selection: null }]);
  });

  it("names every drawn grid of another group in its badge", () => {
    let g = applyGridTo(twoGrids(), 0, [3], "all");
    g = setSkipped(g, 2, true);
    expect(pageBadge(g, 3, 0)).toBe("3×3, 1×4");
    expect(pageBadge(g, 3, 0, { 3: [{ center: { x: 0.5, y: 0.5 }, width: 0.1, height: 0.1, angle_deg: 0 }] })).toBe(
      "3×3, 1×4 + 1",
    );
    const one = applyGridTo(twoGrids(), 0, [3], 1);
    expect(pageBadge(one, 3, 0)).toBe("1×4");
  });

  it("lists the drawn grids with their numbers, skipping the ones with no region", () => {
    const g = updateGrid(twoGrids(), 0, 0, (r) => ({ ...r, selection: null }));
    const group = g[0] as GridGroup;
    expect(drawnGrids(group).map((d) => d.n)).toEqual([1]);
    expect(hasRegion(group)).toBe(true);
    expect(activeRegion(group, 7).selection).toEqual(other);
  });

  it("clears the region of one grid only, on one page", () => {
    const g = clearGridRegion(twoGrids(), 2, true, 1);
    expect((groupAt(g, 2) as GridGroup).grids.map((r) => r.selection)).toEqual([sel, null]);
    expect((groupAt(g, 1) as GridGroup).grids.map((r) => r.selection)).toEqual([sel, other]);
  });
});

describe("names, colors and folders of grids", () => {
  const three = () => {
    let groups = addGrid(addGrid(defaultGroups(2), 0), 0);
    groups = updateGrid(groups, 0, 0, (r) => withLook(r, { folder: "Folder 1" }));
    return updateGrid(groups, 0, 2, (r) => withLook(r, { folder: "Folder 1", name: "Tokens" }));
  };

  it("sets and clears a grid's look, leaving no empty keys", () => {
    const r = withLook(newGridRegion(), { name: "Cards", color: "#3b82f6" });
    expect(r).toMatchObject({ name: "Cards", color: "#3b82f6" });
    expect(Object.keys(withLook(r, { name: undefined, color: undefined }))).toEqual(["grid", "selection"]);
    expect(cleanGridName("  ")).toBeUndefined();
    expect(cleanGridName(` ${"a".repeat(50)}`)).toHaveLength(MAX_GRID_NAME);
  });

  it("lists folders and their grids, and names a new folder after the others", () => {
    const g = gridGroupAt(three(), 0) as GridGroup;
    expect(folderNames(g)).toEqual(["Folder 1"]);
    expect(folderGrids(g, "Folder 1")).toEqual([0, 2]);
    expect(newFolderName(g, "Folder")).toBe("Folder 2");
  });

  it("renames a folder on every grid in it, or ungroups it", () => {
    const renamed = gridGroupAt(renameFolder(three(), 1, "Folder 1", "Top"), 0) as GridGroup;
    expect(renamed.grids.map((r) => r.folder)).toEqual(["Top", undefined, "Top"]);
    const ungrouped = gridGroupAt(renameFolder(three(), 0, "Folder 1", undefined), 0) as GridGroup;
    expect(folderNames(ungrouped)).toEqual([]);
    expect(ungrouped.grids[2].name).toBe("Tokens");
  });

  it("copies names, colors and folders with Apply this grid to…", () => {
    const out = applyGridTo(three(), 0, [1], "all");
    expect((gridGroupAt(out, 1) as GridGroup).grids.map((r) => [r.name, r.folder])).toEqual([
      [undefined, "Folder 1"],
      [undefined, undefined],
      ["Tokens", "Folder 1"],
    ]);
  });
});

describe("moving grids and folders in the list", () => {
  /** Four grids: 0 and 2 in folder "A", 1 and 3 on their own. */
  const make = (): GridGroup => {
    let groups = addGrid(addGrid(addGrid(defaultGroups(1), 0), 0), 0);
    groups = updateGrid(groups, 0, 0, (r) => withLook(r, { name: "g0", folder: "A" }));
    groups = updateGrid(groups, 0, 1, (r) => withLook(r, { name: "g1" }));
    groups = updateGrid(groups, 0, 2, (r) => withLook(r, { name: "g2", folder: "A" }));
    groups = updateGrid(groups, 0, 3, (r) => withLook(r, { name: "g3" }));
    return gridGroupAt(groups, 0) as GridGroup;
  };
  const names = (g: GridGroup) => g.grids.map((r) => `${r.name}${r.folder ? `/${r.folder}` : ""}`);
  const grid = (n: number) => ({ kind: "grid" as const, n });
  const folder = (name: string) => ({ kind: "folder" as const, name });

  it("lists a folder where its first grid is, with its grids", () => {
    expect(gridList(make())).toEqual([{ kind: "folder", name: "A", grids: [0, 2] }, grid(1), grid(3)]);
  });

  it("moves a grid before another, renumbering the grids", () => {
    const out = moveInGridList(make(), grid(3), { place: "before", item: grid(1) });
    // The folder's grids are read together, where the folder is.
    expect(out?.order).toEqual([0, 2, 3, 1]);
    expect(names(out?.group as GridGroup)).toEqual(["g0/A", "g2/A", "g3", "g1"]);
  });

  it("puts a grid into a folder, or next to a grid of the folder, and takes it out again", () => {
    const into = moveInGridList(make(), grid(3), { place: "into", folder: "A" })?.group as GridGroup;
    expect(names(into)).toEqual(["g0/A", "g2/A", "g3/A", "g1"]);
    const beside = moveInGridList(make(), grid(1), { place: "before", item: grid(2) })?.group as GridGroup;
    expect(names(beside)).toEqual(["g0/A", "g1/A", "g2/A", "g3"]);
    const out = moveInGridList(make(), grid(0), { place: "after", item: grid(3) })?.group as GridGroup;
    expect(names(out)).toEqual(["g2/A", "g1", "g3", "g0"]);
  });

  it("moves a folder with its grids, never into itself", () => {
    const out = moveInGridList(make(), folder("A"), { place: "after", item: grid(3) });
    expect(out?.order).toEqual([1, 3, 0, 2]);
    expect(moveInGridList(make(), folder("A"), { place: "into", folder: "A" })).toBeNull();
    expect(moveInGridList(make(), grid(1), { place: "before", item: grid(1) })).toBeNull();
    // The first move puts a folder's grids together; once they are, a grid dropped where it is changes nothing.
    const once = moveInGridList(make(), grid(1), { place: "after", item: folder("A") });
    expect(once?.order).toEqual([0, 2, 1, 3]);
    expect(moveInGridList(once?.group as GridGroup, grid(2), { place: "after", item: folder("A") })).toBeNull();
  });

  it("keeps an empty folder first until a grid is dropped in it, and forgets it when it is deleted", () => {
    const groups = addFolder([make()], 0, "B");
    const g = gridGroupAt(groups, 0) as GridGroup;
    expect(gridList(g)[0]).toEqual({ kind: "folder", name: "B", grids: [] });
    const filled = moveInGridList(g, grid(3), { place: "into", folder: "B" })?.group as GridGroup;
    expect(names(filled)).toEqual(["g3/B", "g0/A", "g2/A", "g1"]);
    expect(folderNames(gridGroupAt(renameFolder(groups, 0, "B", undefined), 0) as GridGroup)).toEqual(["A"]);
  });
});

describe("removed pages", () => {
  it("are skipped pages of their own, not joined with pages that are only skipped", () => {
    let g = setSkipped(defaultGroups(6), 1, true);
    g = removePage(removePage(g, 2), 3);
    expect(g.map((x) => [x.kind, x.pages.first, x.pages.last])).toEqual([
      ["grid", 0, 0],
      ["skip", 1, 1],
      ["skip", 2, 3],
      ["grid", 4, 5],
    ]);
    expect(removedPages(g)).toEqual([2, 3]);
    expect(isRemoved(g, 1)).toBe(false);
    expect(includedPages(g)).toEqual([0, 4, 5]);
    // Brought back, a page is included again; applying a grid leaves removed pages alone.
    const back = setSkipped(g, 3, false);
    expect(removedPages(back)).toEqual([2]);
    expect(isSkipped(back, 3)).toBe(false);
    expect(removedPages(applyGridTo(g, 0, [2, 3, 4]))).toEqual([2, 3]);
  });

  it("are stepped over, and the nearest page in view stands in for one", () => {
    const g = removePage(removePage(defaultGroups(5), 1), 4);
    expect(shownPage(g, 5, 0, 1)).toBe(2);
    expect(shownPage(g, 5, 2, -1)).toBe(0);
    expect(shownPage(g, 5, 3, 1)).toBe(3);
    expect(shownPage(g, 5, 1, 0)).toBe(2);
    expect(shownPage(g, 5, 4, 0)).toBe(3);
  });
});
