// The document model: which pages are cut into cards (and how) and which are skipped.
//
// A document is a list of page groups that together cover every page, in order, with no
// gaps. All edits are pure functions from groups to groups, so they are easy to test and
// the store can record each result as one undo step. Output settings (gap, page size,
// margins) are not part of a group; they stay global until the Print stage (M13).

import { t } from "../i18n";
import type { OrientedRect } from "./card";
import { clamp, type NormalizedRect } from "./coordinates";
import { clampCount } from "./grid";
import type { PageSize } from "./tauri";

export const MAX_GAP_MM = 50;
const gap = (mm: number) => clamp(mm, 0, MAX_GAP_MM);

/** Inclusive range of 0-based page indexes. */
export type PageRange = { first: number; last: number };

/** The source grid of a group: how the card region is divided, and the spacing the PDF already has. */
export type GroupGrid = {
  rows: number;
  columns: number;
  sourceGapXMm: number;
  sourceGapYMm: number;
  /** When linked, the vertical value follows the horizontal one. */
  sourceGapLinked: boolean;
};

export const DEFAULT_GROUP_GRID: GroupGrid = {
  rows: 3,
  columns: 3,
  sourceGapXMm: 0,
  sourceGapYMm: 0,
  sourceGapLinked: true,
};

/**
 * One grid of a group: how it divides its region, and the region (normalized to the page; null = not drawn yet).
 * `name` and `color` are the user's, to tell grids apart: without them the grid is "Grid n" in the accent colour.
 * `folder` is the name of the folder it is in, if any: the grids with the same folder name are listed together and
 * can be picked and moved together. A folder exists while a grid is in it.
 */
export type GridRegion = {
  grid: GroupGrid;
  selection: NormalizedRect | null;
  name?: string;
  color?: string;
  folder?: string;
  /** Not drawn on the page (the eye in the Grids list), and not edited there; it still has its pieces and prints. */
  hidden?: boolean;
};

/** What the user can set on a grid besides its layout: a key given as undefined clears it. */
export type GridLook = { name?: string; color?: string; folder?: string; hidden?: boolean };

/**
 * Pages cut into pieces with one or more grids, each inside its own region. There is always at least one; a grid's
 * place in the list is its number in its pieces' ids (`CardId.grid`), so the first grid's pieces keep the ids they had
 * before a page could hold several.
 */
export type GridGroup = {
  kind: "grid";
  pages: PageRange;
  grids: GridRegion[];
  /** The group's folders, empty ones included, in list order; a folder a grid names is a folder even when missing. */
  folders?: string[];
};

/** How many grids a page can hold. */
export const MAX_GRIDS = 9;

/** The colours a grid can be given, picked to read on the light and the dark theme. */
export const GRID_COLORS = [
  { id: "blue", hex: "#3b82f6" },
  { id: "red", hex: "#ef4444" },
  { id: "green", hex: "#22c55e" },
  { id: "amber", hex: "#f59e0b" },
  { id: "pink", hex: "#ec4899" },
  { id: "teal", hex: "#14b8a6" },
  { id: "orange", hex: "#f97316" },
  { id: "indigo", hex: "#6366f1" },
] as const;

/** How long a grid's name can be. */
export const MAX_GRID_NAME = 40;

/** A name as typed, trimmed and cut to `MAX_GRID_NAME`; empty means the grid goes back to "Grid n". */
export const cleanGridName = (raw: string): string | undefined =>
  raw.trim().slice(0, MAX_GRID_NAME).trim() || undefined;

/** A grid's name, colour and folder set or cleared (a key given as undefined), leaving no empty keys behind. */
export function withLook(r: GridRegion, look: GridLook): GridRegion {
  const next: GridRegion = { ...r, ...look };
  if (next.name === undefined) delete next.name;
  if (next.color === undefined) delete next.color;
  if (next.folder === undefined) delete next.folder;
  if (!next.hidden) delete next.hidden;
  return next;
}

/** The folders of `g`: the ones with no grid yet (`folders`), then the others in the order their first grid comes. */
export function folderNames(g: GridGroup): string[] {
  const used = g.grids.flatMap((r) => (r.folder === undefined ? [] : [r.folder]));
  return [...new Set([...(g.folders ?? []).filter((f) => !used.includes(f)), ...used])];
}

/** The numbers of the grids of `g` in `folder`. */
export const folderGrids = (g: GridGroup, folder: string): number[] =>
  g.grids.flatMap((r, n) => (r.folder === folder ? [n] : []));

/** `base` with the first number that no folder of `g` has: "Folder 1", "Folder 2"… */
export function newFolderName(g: GridGroup, base: string): string {
  const taken = new Set(folderNames(g));
  let k = 1;
  while (taken.has(`${base} ${k}`)) k++;
  return `${base} ${k}`;
}

/** `g` with `folders` set to `names`, or without the key when there are none. */
function withFolders(g: GridGroup, names: string[]): GridGroup {
  const { folders: _old, ...rest } = g;
  return names.length > 0 ? { ...rest, folders: names } : rest;
}

/** Adds an empty folder called `name` to the grid group `page` belongs to; it is listed first until a grid is in it. */
export function addFolder(groups: PageGroup[], page: number, name: string): PageGroup[] {
  return updateGridGroup(groups, page, (g) =>
    folderNames(g).includes(name) ? g : withFolders(g, [name, ...folderNames(g)]),
  );
}

/**
 * Renames `folder` in the grid group `page` belongs to (every grid in it), or ungroups it with `to` undefined (an
 * empty folder is then gone). A name another folder has merges the two.
 */
export function renameFolder(groups: PageGroup[], page: number, folder: string, to: string | undefined): PageGroup[] {
  return updateGridGroup(groups, page, (g) => {
    if (!folderNames(g).includes(folder)) return g;
    const grids = g.grids.map((r) => (r.folder === folder ? withLook(r, { folder: to }) : r));
    const names = folderNames(g).flatMap((f) => (f !== folder ? [f] : to === undefined ? [] : [to]));
    return withFolders({ ...g, grids }, [...new Set(names)]);
  });
}

/**
 * The Grids list as it is shown: empty folders first, then the grids in order, a folder standing where its first grid
 * is and holding its grids.
 */
export type GridListItem = { kind: "grid"; n: number } | { kind: "folder"; name: string; grids: number[] };

export function gridList(g: GridGroup): GridListItem[] {
  const items: GridListItem[] = [];
  const seen = new Set<string>();
  for (const name of folderNames(g))
    if (!g.grids.some((r) => r.folder === name)) {
      seen.add(name);
      items.push({ kind: "folder", name, grids: [] });
    }
  g.grids.forEach((r, n) => {
    if (r.folder === undefined) items.push({ kind: "grid", n });
    else if (!seen.has(r.folder)) {
      seen.add(r.folder);
      items.push({ kind: "folder", name: r.folder, grids: folderGrids(g, r.folder) });
    }
  });
  return items;
}

/** What is dragged in the Grids list. */
export type ListRef = { kind: "grid"; n: number } | { kind: "folder"; name: string };
/** Where it is dropped: before or after a grid or a folder, or into a folder (at its end). */
export type ListDrop = { place: "before" | "after"; item: ListRef } | { place: "into"; folder: string };

const sameRef = (a: ListRef, b: ListRef) =>
  a.kind === "grid" ? b.kind === "grid" && a.n === b.n : b.kind === "folder" && a.name === b.name;

/**
 * `g` with `drag` moved to `drop` in its list: the grids in their new order (a grid's number is its place, so the
 * pieces of the grids that moved get new numbers) and each grid in the folder it landed in. A grid dropped next to a
 * grid in a folder joins that folder; a folder dropped there goes next to that folder. `order` is the old number of
 * each grid in its new place; null when nothing changes.
 */
export function moveInGridList(
  g: GridGroup,
  drag: ListRef,
  drop: ListDrop,
): { group: GridGroup; order: number[] } | null {
  if (drop.place !== "into" && sameRef(drag, drop.item)) return null;
  if (drop.place === "into" && drag.kind === "folder") {
    if (drag.name === drop.folder) return null;
    return moveInGridList(g, drag, { place: "after", item: { kind: "folder", name: drop.folder } });
  }
  const items = gridList(g).map((it) => (it.kind === "folder" ? { ...it, grids: [...it.grids] } : it));
  // Take the dragged one out.
  let moving: GridListItem;
  if (drag.kind === "folder") {
    const i = items.findIndex((it) => it.kind === "folder" && it.name === drag.name);
    if (i < 0) return null;
    moving = items.splice(i, 1)[0];
  } else {
    moving = { kind: "grid", n: drag.n };
    const top = items.findIndex((it) => it.kind === "grid" && it.n === drag.n);
    if (top >= 0) items.splice(top, 1);
    else
      for (const it of items)
        if (it.kind === "folder" && it.grids.includes(drag.n)) it.grids = it.grids.filter((n) => n !== drag.n);
  }
  // Put it where it was dropped.
  const topIndex = (ref: ListRef) =>
    items.findIndex((it) =>
      ref.kind === "folder" ? it.kind === "folder" && it.name === ref.name : it.kind === "grid" && it.n === ref.n,
    );
  if (drop.place === "into") {
    const f = items.find((it) => it.kind === "folder" && it.name === drop.folder);
    if (f?.kind !== "folder" || moving.kind !== "grid") return null;
    f.grids.push(moving.n);
  } else {
    const at = topIndex(drop.item);
    const holder =
      drop.item.kind === "grid"
        ? items.find((it) => it.kind === "folder" && it.grids.includes((drop.item as { n: number }).n))
        : undefined;
    if (holder && holder.kind === "folder") {
      if (moving.kind === "grid") {
        const j = holder.grids.indexOf((drop.item as { n: number }).n);
        holder.grids.splice(drop.place === "before" ? j : j + 1, 0, moving.n);
      } else {
        const h = items.indexOf(holder);
        items.splice(drop.place === "before" ? h : h + 1, 0, moving);
      }
    } else {
      if (at < 0) return null;
      items.splice(drop.place === "before" ? at : at + 1, 0, moving);
    }
  }
  // Read the grids back in list order, each with the folder it is in.
  const order: number[] = [];
  const folderOf = new Map<number, string | undefined>();
  for (const it of items)
    if (it.kind === "grid") {
      order.push(it.n);
      folderOf.set(it.n, undefined);
    } else
      for (const n of it.grids) {
        order.push(n);
        folderOf.set(n, it.name);
      }
  const names = items.flatMap((it) => (it.kind === "folder" ? [it.name] : []));
  const grids = order.map((n) => withLook(g.grids[n], { folder: folderOf.get(n) }));
  const unchanged =
    order.every((n, i) => n === i) &&
    grids.every((r, i) => r.folder === g.grids[i].folder) &&
    names.join("\n") === folderNames(g).join("\n");
  if (unchanged) return null;
  // Folders that hold grids are found from them; only the empty ones need the list, kept in list order.
  return { group: withFolders({ ...g, grids }, names), order };
}

/** A new grid with the default settings and no region. */
export const newGridRegion = (): GridRegion => ({ grid: { ...DEFAULT_GROUP_GRID }, selection: null });

/** A grid group with one grid, as every group had before a page could hold several. */
export const singleGridGroup = (pages: PageRange, grid: GroupGrid, selection: NormalizedRect | null): GridGroup => ({
  kind: "grid",
  pages,
  grids: [{ grid, selection }],
});

/** `active` (the grid being edited) brought into the group's list. */
export const activeIndex = (g: GridGroup, active: number): number => Math.min(Math.max(active, 0), g.grids.length - 1);

/** The grid of `g` being edited. */
export const activeRegion = (g: GridGroup, active: number): GridRegion => g.grids[activeIndex(g, active)];

/** The grids of `g` whose region is drawn, with their numbers. */
export const drawnGrids = (g: GridGroup): { n: number; region: GridRegion & { selection: NormalizedRect } }[] =>
  g.grids.flatMap((region, n) => (region.selection ? [{ n, region: { ...region, selection: region.selection } }] : []));

/** Whether any grid of `g` has a region drawn. */
export const hasRegion = (g: GridGroup): boolean => g.grids.some((r) => r.selection !== null);
/** Pages left out of the export. */
export type SkipGroup = { kind: "skip"; pages: PageRange };
export type PageGroup = GridGroup | SkipGroup;

/**
 * Cards drawn one by one (M18), by page: each an oriented rect normalized to the page. They sit beside
 * the groups, not in them, so a page can have a grid and freeform cards. Pages that are skipped keep
 * their cards but leave them out of the export.
 */
export type FreeformCards = Record<number, OrientedRect[]>;

export const pageCount = (r: PageRange) => r.last - r.first + 1;

/** "Page 3" or "Pages 3–9" (1-based, as the user sees them). */
export const rangeLabel = (r: PageRange) =>
  r.first === r.last
    ? t("common.page", { n: r.first + 1 })
    : t("common.pages", { first: r.first + 1, last: r.last + 1 });

/** One grid group over all pages: the starting point for a new document. */
export function defaultGroups(totalPages: number): PageGroup[] {
  if (totalPages <= 0) return [];
  return [singleGridGroup({ first: 0, last: totalPages - 1 }, { ...DEFAULT_GROUP_GRID }, null)];
}

export const groupIndexAt = (groups: PageGroup[], page: number) =>
  groups.findIndex((g) => page >= g.pages.first && page <= g.pages.last);

export const groupAt = (groups: PageGroup[], page: number): PageGroup | undefined => groups[groupIndexAt(groups, page)];

/** The grid group `page` belongs to, or undefined when it is skipped or not covered. */
export function gridGroupAt(groups: PageGroup[], page: number): GridGroup | undefined {
  const g = groupAt(groups, page);
  return g?.kind === "grid" ? g : undefined;
}

export const isSkipped = (groups: PageGroup[], page: number) => groupAt(groups, page)?.kind === "skip";

/** Pages that are cut into cards (every page not in a skip group), in order. */
export function includedPages(groups: PageGroup[]): number[] {
  const out: number[] = [];
  for (const g of groups) {
    if (g.kind === "skip") continue;
    for (let p = g.pages.first; p <= g.pages.last; p++) out.push(p);
  }
  return out;
}

/** Whether two groups have the same treatment (ignoring which pages they cover). */
function sameTreatment(a: PageGroup, b: PageGroup): boolean {
  if (a.kind !== b.kind) return false;
  const { pages: _a, ...ra } = a;
  const { pages: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
}

/** Joins neighbouring skip groups: skipping is a property of a page, not of how it was reached. */
function mergeSkips(groups: PageGroup[]): PageGroup[] {
  const out: PageGroup[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last?.kind === "skip" && g.kind === "skip")
      out[out.length - 1] = { ...last, pages: { ...last.pages, last: g.pages.last } };
    else out.push(g);
  }
  return out;
}

/** Makes `page` the first page of a group, splitting the group it is in. A copy of the group's settings goes to both halves. */
function splitBefore(groups: PageGroup[], page: number): PageGroup[] {
  const i = groupIndexAt(groups, page);
  if (i < 0) return groups;
  const g = groups[i];
  if (g.pages.first === page) return groups;
  const head: PageGroup = { ...g, pages: { first: g.pages.first, last: page - 1 } };
  const tail: PageGroup = { ...g, pages: { first: page, last: g.pages.last } };
  return [...groups.slice(0, i), head, tail, ...groups.slice(i + 1)];
}

/** Splits so that `range` is covered by whole groups, then replaces them with `replacement`. */
function replaceRange(groups: PageGroup[], range: PageRange, replacement: PageGroup): PageGroup[] {
  const split = splitBefore(splitBefore(groups, range.first), range.last + 1);
  const before = split.filter((g) => g.pages.last < range.first);
  const after = split.filter((g) => g.pages.first > range.last);
  return mergeSkips([...before, replacement, ...after]);
}

/** Skip or include one page. Including it joins the neighbouring grid group when there is one. */
export function setSkipped(groups: PageGroup[], page: number, skip: boolean): PageGroup[] {
  const current = groupAt(groups, page);
  if (!current || (current.kind === "skip") === skip) return groups;
  const range = { first: page, last: page };
  if (skip) return replaceRange(groups, range, { kind: "skip", pages: range });

  const split = splitBefore(splitBefore(groups, page), page + 1);
  const i = groupIndexAt(split, page);
  const prev = split[i - 1];
  const next = split[i + 1];
  const out = [...split];
  if (prev?.kind === "grid") {
    // Re-including a page in the middle of a section rejoins the two halves.
    const rejoin = next?.kind === "grid" && sameTreatment(prev, next) ? next : null;
    const last = rejoin ? rejoin.pages.last : page;
    out.splice(i - 1, rejoin ? 3 : 2, { ...prev, pages: { first: prev.pages.first, last } });
    return out;
  }
  if (next?.kind === "grid") {
    out.splice(i, 1);
    out[i] = { ...next, pages: { first: page, last: next.pages.last } };
    return out;
  }
  out[i] = singleGridGroup(range, { ...DEFAULT_GROUP_GRID }, null);
  return out;
}

/** Applies `edit` to the grid group `page` belongs to (every page of the group). No-op for other kinds. */
export function updateGridGroup(groups: PageGroup[], page: number, edit: (g: GridGroup) => GridGroup): PageGroup[] {
  const i = groupIndexAt(groups, page);
  const g = groups[i];
  if (g?.kind !== "grid") return groups;
  const next = edit(g);
  return next === g ? groups : groups.map((x, j) => (j === i ? next : x));
}

/** Applies `edit` to grid number `n` of the grid group `page` belongs to (every page of the group). */
export function updateGrid(
  groups: PageGroup[],
  page: number,
  n: number,
  edit: (r: GridRegion) => GridRegion,
): PageGroup[] {
  return updateGridGroup(groups, page, (g) => {
    const region = g.grids[n];
    if (!region) return g;
    const next = edit(region);
    return next === region ? g : { ...g, grids: g.grids.map((r, i) => (i === n ? next : r)) };
  });
}

/** Adds a grid with no region to the grid group `page` belongs to, up to `MAX_GRIDS`. */
export function addGrid(groups: PageGroup[], page: number): PageGroup[] {
  return updateGridGroup(groups, page, (g) =>
    g.grids.length >= MAX_GRIDS ? g : { ...g, grids: [...g.grids, newGridRegion()] },
  );
}

/**
 * Deletes grid number `n` of the grid group `page` belongs to; the grids after it move up a place. The last grid of a
 * group is not deleted but loses its region, so a grid group always has one.
 */
export function deleteGrid(groups: PageGroup[], page: number, n: number): PageGroup[] {
  return updateGridGroup(groups, page, (g) => {
    if (!g.grids[n]) return g;
    if (g.grids.length === 1) return { ...g, grids: [{ ...g.grids[0], selection: null }] };
    return { ...g, grids: g.grids.filter((_, i) => i !== n) };
  });
}

/**
 * Clears the piece region of grid number `n` of `page`'s grid group (the grid keeps its rows, columns and gaps, and
 * finds no pieces until a region is drawn again). With `onlyPage` the page leaves its group first, as in "Apply this
 * grid to…", so the other pages of the group keep their region.
 */
export function clearGridRegion(groups: PageGroup[], page: number, onlyPage: boolean, n = 0): PageGroup[] {
  const g = gridGroupAt(groups, page);
  if (!g?.grids[n] || g.grids[n].selection === null) return groups;
  const clear = (x: GridGroup): GridGroup => ({
    ...x,
    grids: x.grids.map((r, i) => (i === n ? { ...r, selection: null } : r)),
  });
  if (!onlyPage) return updateGridGroup(groups, page, clear);
  const range = { first: page, last: page };
  return replaceRange(groups, range, clear({ ...g, pages: range }));
}

const copyRegion = (r: GridRegion): GridRegion => ({
  ...r,
  grid: { ...r.grid },
  selection: r.selection ? { ...r.selection } : null,
});

/**
 * Copies grids of the grid group at `source` onto `pages`, as separate groups from the one they came from: grid
 * number `which` (the page then has that grid alone), or every grid with `"all"`.
 */
export function applyGridTo(
  groups: PageGroup[],
  source: number,
  pages: number[],
  which: number | "all" = 0,
): PageGroup[] {
  const from = gridGroupAt(groups, source);
  if (!from) return groups;
  const grids = which === "all" ? from.grids : from.grids[which] ? [from.grids[which]] : [];
  if (grids.length === 0) return groups;
  let out = groups;
  for (const run of runsOf(pages)) {
    const folders = which === "all" && from.folders ? { folders: [...from.folders] } : {};
    out = replaceRange(out, run, { kind: "grid", pages: run, grids: grids.map(copyRegion), ...folders });
  }
  return out;
}

/** Consecutive pages as inclusive ranges: [1, 2, 3, 7] -> 1-3, 7-7. Input may be unsorted and repeat. */
export function runsOf(pages: number[]): PageRange[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: PageRange[] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.last === p - 1) last.last = p;
    else runs.push({ first: p, last: p });
  }
  return runs;
}

/** Pages the same size as `page` (within half a point), not counting skipped pages. Includes `page` itself. */
export function pagesOfSameSize(groups: PageGroup[], sizes: PageSize[], page: number): number[] {
  const ref = sizes[page];
  if (!ref) return [];
  const same = (s: PageSize) =>
    Math.abs(s.width_pt - ref.width_pt) < 0.5 && Math.abs(s.height_pt - ref.height_pt) < 0.5;
  return sizes.flatMap((s, p) => (same(s) && (p === page || !isSkipped(groups, p)) ? [p] : []));
}

/** Pages `first`..`last` (1-based or not; the caller converts), clamped to the document and in either order. */
export function clampRange(first: number, last: number, totalPages: number): PageRange {
  const [a, b] = first <= last ? [first, last] : [last, first];
  return { first: clamp(a, 0, totalPages - 1), last: clamp(b, 0, totalPages - 1) };
}

/** The drawn grids of `g` as rows × columns, in order: "3×3", "3×3, 2×4". */
export const gridsLabel = (g: GridGroup): string =>
  drawnGrids(g)
    .map(({ region }) => `${region.grid.rows}×${region.grid.columns}`)
    .join(", ");

/**
 * Short label for a thumbnail whose page belongs to a different group than the viewed one:
 * the grids ("3×3", "3×3, 2×2"), "No region" until one is drawn, or "Skipped", plus the freeform pieces the page
 * has ("3×3 + 2", "2 pieces"). Null for the viewed group.
 */
export function pageBadge(
  groups: PageGroup[],
  page: number,
  viewed: number,
  freeform: FreeformCards = {},
): string | null {
  const g = groupAt(groups, page);
  if (!g || g === groupAt(groups, viewed)) return null;
  if (g.kind === "skip") return t("pages.badge.skipped");
  const own = freeform[page]?.length ?? 0;
  if (!hasRegion(g)) return own > 0 ? t("pages.badge.pieces", { count: own }) : t("pages.badge.noRegion");
  return `${gridsLabel(g)}${own > 0 ? ` + ${own}` : ""}`;
}

export type GridPatch = Partial<GroupGrid>;

/** The grid after `patch`: counts and gaps are clamped, and a linked vertical gap follows the horizontal one. */
export function patchGrid(grid: GroupGrid, patch: GridPatch): GroupGrid {
  const next = { ...grid, ...patch };
  if (patch.rows !== undefined) next.rows = clampCount(patch.rows);
  if (patch.columns !== undefined) next.columns = clampCount(patch.columns);
  if (patch.sourceGapXMm !== undefined) next.sourceGapXMm = gap(patch.sourceGapXMm);
  if (patch.sourceGapYMm !== undefined) next.sourceGapYMm = gap(patch.sourceGapYMm);
  if (next.sourceGapLinked && (patch.sourceGapXMm !== undefined || patch.sourceGapLinked !== undefined))
    next.sourceGapYMm = next.sourceGapXMm;
  return next;
}
