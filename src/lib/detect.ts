// What a detected proposal means for the editor (M17): pure functions from Rust's answer (points,
// top-left origin) to the UI's own model (normalized coordinates, via `coordinates.ts`). Nothing
// here touches a store; applying a proposal is `layout-store`'s job and always the user's choice.

import type { OrientedRect } from "./card";
import { type NormalizedRect, orientedFromPoints } from "./coordinates";
import type { Proposal } from "./detect-api";
import { clampCount } from "./grid";
import type { PageSize } from "./tauri";

/** A proposal from this confidence up is "good"; from `EXACT` and the PDF's own objects it is "exact". */
export const GOOD_CONFIDENCE = 0.7;
export const EXACT_CONFIDENCE = 0.9;

export type ConfidenceBand = "exact" | "good" | "low";

/** How sure a proposal is, in a word. Only the PDF's own objects can read as exact. */
export function confidenceBand(p: Pick<Proposal, "confidence" | "engine">): ConfidenceBand {
  if (p.engine === "pdf-objects" && p.confidence >= EXACT_CONFIDENCE) return "exact";
  return p.confidence >= GOOD_CONFIDENCE ? "good" : "low";
}

/** What a grid proposal sets on a page group: the region and the grid fields. */
export type DetectedGrid = {
  selection: NormalizedRect;
  rows: number;
  columns: number;
  sourceGapXMm: number;
  sourceGapYMm: number;
  sourceGapLinked: boolean;
};

const unit = (v: number) => Math.min(Math.max(v, 0), 1);
const GAP_EPSILON_MM = 0.05;

/** The region and grid of a `grid` proposal. The region is pulled inside the page, as the layout engine needs. */
export function gridFromProposal(p: Proposal, page: PageSize): DetectedGrid | null {
  if (p.kind !== "grid") return null;
  const x0 = unit(p.bounds.x / page.width_pt);
  const y0 = unit(p.bounds.y / page.height_pt);
  const x1 = unit((p.bounds.x + p.bounds.width) / page.width_pt);
  const y1 = unit((p.bounds.y + p.bounds.height) / page.height_pt);
  const gapX = Math.max(p.source_gap_x_mm, 0);
  const gapY = Math.max(p.source_gap_y_mm, 0);
  return {
    selection: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    rows: clampCount(p.rows),
    columns: clampCount(p.columns),
    sourceGapXMm: gapX,
    sourceGapYMm: gapY,
    sourceGapLinked: Math.abs(gapX - gapY) < GAP_EPSILON_MM,
  };
}

/** The pieces of a `rects` proposal, normalized to the page like every freeform piece. */
export function piecesFromProposal(p: Proposal, page: PageSize): OrientedRect[] | null {
  return p.kind === "rects" ? p.rects.map((r) => orientedFromPoints(r, page)) : null;
}

/** How many pieces applying the proposal would give. */
export const pieceCount = (p: Proposal): number => (p.kind === "grid" ? p.rows * p.columns : p.rects.length);
