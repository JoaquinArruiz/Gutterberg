// The document model: which pages are cut into cards (and how) and which are skipped.
//
// A document is a list of page groups that together cover every page, in order, with no
// gaps. All edits are pure functions from groups to groups, so they are easy to test and
// the store can record each result as one undo step. Output settings (gap, page size,
// margins) are not part of a group; they stay global until the Print stage (M13).

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

/** Pages cut into cards with one grid inside one region (normalized to the page; null = not drawn yet). */
export type GridGroup = { kind: "grid"; pages: PageRange; grid: GroupGrid; selection: NormalizedRect | null };
/** Pages left out of the export. */
export type SkipGroup = { kind: "skip"; pages: PageRange };
/**
 * Pages whose cards are drawn one by one (M18), each an oriented rect normalized to the page.
 * Reserved: nothing creates it yet, and export treats it as not supported.
 */
export type FreeformGroup = { kind: "freeform"; pages: PageRange; cards: OrientedRect[] };
export type PageGroup = GridGroup | SkipGroup | FreeformGroup;

export const pageCount = (r: PageRange) => r.last - r.first + 1;

/** "Page 3" or "Pages 3–9" (1-based, as the user sees them). */
export const rangeLabel = (r: PageRange) =>
  r.first === r.last ? `Page ${r.first + 1}` : `Pages ${r.first + 1}–${r.last + 1}`;

/** One grid group over all pages: the starting point for a new document. */
export function defaultGroups(totalPages: number): PageGroup[] {
  if (totalPages <= 0) return [];
  return [
    { kind: "grid", pages: { first: 0, last: totalPages - 1 }, grid: { ...DEFAULT_GROUP_GRID }, selection: null },
  ];
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
  out[i] = { kind: "grid", pages: range, grid: { ...DEFAULT_GROUP_GRID }, selection: null };
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

/** Copies the grid and region of the grid group at `source` onto `pages`, as separate groups from the one they came from. */
export function applyGridTo(groups: PageGroup[], source: number, pages: number[]): PageGroup[] {
  const from = gridGroupAt(groups, source);
  if (!from) return groups;
  let out = groups;
  for (const run of runsOf(pages)) {
    out = replaceRange(out, run, {
      kind: "grid",
      pages: run,
      grid: { ...from.grid },
      selection: from.selection ? { ...from.selection } : null,
    });
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

/**
 * Short label for a thumbnail whose page belongs to a different group than the viewed one:
 * the grid ("3×3"), "No region" until one is drawn, or "Skipped". Null for the viewed group.
 */
export function pageBadge(groups: PageGroup[], page: number, viewed: number): string | null {
  const g = groupAt(groups, page);
  if (!g || g === groupAt(groups, viewed)) return null;
  if (g.kind === "skip") return "Skipped";
  if (g.kind === "freeform") return "Freeform";
  return g.selection ? `${g.grid.rows}×${g.grid.columns}` : "No region";
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
