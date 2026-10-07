// The print stage's plan, and how it becomes the request the Rust planner takes. The plan only
// records what the user chose; where cards land is decided in Rust (`card_core::sheet`).

import { gridPayload, type OutputSettings, outputPage } from "../stores/layout-store";
import { cardIdKey } from "./card";
import { orientedToPoints } from "./coordinates";
import type { PageGroup } from "./document-layout";
import type {
  Card,
  CardSetting,
  PaginateOptionsPayload,
  PrintLayoutPayload,
  PrintRequest,
  RustGroup,
  SheetPagePayload,
} from "./sheet-api";
import type { PageSize } from "./tauri";

/** Every card once, in order (today's behaviour), or only the cards given a quantity. */
export type PlanMode = "all" | "custom";
/** `same`: each source page keeps its own grid. `auto`: as many per sheet as fit. `custom`: rows x columns. */
export type SheetGridMode = "same" | "auto" | "custom";
export type CardOrder = "grouped" | "interleaved";

export type PrintPlan = {
  mode: PlanMode;
  /** Copies per card (by `cardIdKey`) in custom mode; cards without an entry are not printed. */
  quantities: Record<string, number>;
  /** Repeat the cards until the last sheet is full. */
  autoFill: boolean;
  order: CardOrder;
  groupBySize: boolean;
  sheetGrid: SheetGridMode;
  rows: number;
  columns: number;
};

export const DEFAULT_PLAN: PrintPlan = {
  mode: "all",
  quantities: {},
  autoFill: false,
  order: "grouped",
  groupBySize: true,
  sheetGrid: "same",
  rows: 3,
  columns: 3,
};

export const MAX_QUANTITY = 99;
export const MAX_SHEET_GRID = 30;

/** Page groups in the Rust shape. Grid groups with no region drawn yet have no cards and are left out. */
export function toRustGroups(groups: PageGroup[], pages: PageSize[], output: OutputSettings): RustGroup[] {
  const out: RustGroup[] = [];
  for (const g of groups) {
    if (g.kind === "skip") out.push({ pages: g.pages, kind: "skip" });
    else if (g.kind === "grid") {
      if (g.selection) out.push({ pages: g.pages, kind: "grid", grid: gridPayload(g.selection, g.grid, output) });
    } else {
      const page = pages[g.pages.first];
      if (page) out.push({ pages: g.pages, kind: "freeform", cards: g.cards.map((c) => orientedToPoints(c, page)) });
    }
  }
  return out;
}

/**
 * The sheet grid the plan really uses. "Same as source" is the default plan only (every card
 * once, in order, each source page on its own sheet), so any other plan falls back to Auto.
 */
export function effectiveGrid(plan: PrintPlan): SheetGridMode {
  return plan.sheetGrid === "same" && (plan.mode !== "all" || plan.autoFill) ? "auto" : plan.sheetGrid;
}

/** The per-card settings the planner needs: in custom mode a quantity for every card (0 = not printed). */
export function planSettings(plan: PrintPlan, cards: Card[]): CardSetting[] {
  if (plan.mode === "all") return [];
  return cards.map((c) => ({
    id: c.id,
    quantity: plan.quantities[cardIdKey(c.id)] ?? 0,
    turn: c.turn,
    scale: c.scale,
  }));
}

function sheetPage(output: OutputSettings): SheetPagePayload {
  if (output.pageMode === "same") return { kind: "same_as_source" };
  if (output.pageMode === "fit") return { kind: "fit" };
  const size = outputPage(output);
  return size ? { kind: "size", ...size } : { kind: "same_as_source" };
}

export function buildPrintRequest(
  plan: PrintPlan,
  cards: Card[],
  groups: PageGroup[],
  pages: PageSize[],
  output: OutputSettings,
): PrintRequest {
  const grid = effectiveGrid(plan);
  const layout: PrintLayoutPayload =
    grid === "same"
      ? { kind: "same_as_source" }
      : {
          kind: "grid",
          spec: {
            page: sheetPage(output),
            rows: grid === "custom" ? plan.rows : null,
            columns: grid === "custom" ? plan.columns : null,
            gap_x_mm: output.gapXMm,
            gap_y_mm: output.gapYMm,
            margins: {
              top_mm: output.margins.top,
              right_mm: output.margins.right,
              bottom_mm: output.margins.bottom,
              left_mm: output.margins.left,
            },
          },
        };
  const options: PaginateOptionsPayload = {
    order: plan.order,
    group_by_size: plan.groupBySize,
    auto_fill: plan.autoFill,
  };
  return { groups: toRustGroups(groups, pages, output), settings: planSettings(plan, cards), layout, options };
}

/** How many copies the plan asks for (not counting auto-fill), for the summary line. */
export function requestedCopies(plan: PrintPlan, cards: Card[]): number {
  if (plan.mode === "all") return cards.length;
  return cards.reduce((n, c) => n + (plan.quantities[cardIdKey(c.id)] ?? 0), 0);
}
