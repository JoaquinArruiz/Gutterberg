// IPC for the print stage. Mirrors card_core::sheet (serde, snake_case); every layout decision is
// made by the Rust engine, this file only describes the requests and parses the answers.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { CardIdSchema, OrientedRectSchema } from "./card";
import type { GridPayload, PageIssue, PageSize } from "./tauri";
import { PageIssueSchema } from "./tauri";

const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const PageSizeSchema = z.object({ width_pt: z.number(), height_pt: z.number() });

/** Output turn in degrees, clockwise. */
export const TurnSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Turn = z.infer<typeof TurnSchema>;

export const CardSchema = z.object({
  id: CardIdSchema,
  source: OrientedRectSchema,
  scale: z.number(),
  turn: TurnSchema,
});
export type Card = z.infer<typeof CardSchema>;

export const SheetPlacementSchema = z.object({
  card_id: CardIdSchema,
  source: OrientedRectSchema,
  destination: RectSchema,
  turn: TurnSchema,
  scale: z.number(),
});
export type SheetPlacement = z.infer<typeof SheetPlacementSchema>;

export const OutputSheetSchema = z.object({ page: PageSizeSchema, placements: z.array(SheetPlacementSchema) });
export type OutputSheet = z.infer<typeof OutputSheetSchema>;

/** What the user decided about one card: how many copies, turned how far, at what scale. */
export type CardSetting = { id: Card["id"]; quantity: number; turn: Turn; scale: number };

export type SheetPagePayload =
  | { kind: "size"; width_pt: number; height_pt: number }
  | { kind: "fit" }
  | { kind: "same_as_source" };

export type SheetSpecPayload = {
  page: SheetPagePayload;
  rows: number | null;
  columns: number | null;
  gap_x_mm: number;
  gap_y_mm: number;
  margins: { top_mm: number; right_mm: number; bottom_mm: number; left_mm: number };
};

export type PrintLayoutPayload = { kind: "same_as_source" } | { kind: "grid"; spec: SheetSpecPayload };

export type PaginateOptionsPayload = { order: "grouped" | "interleaved"; group_by_size: boolean; auto_fill: boolean };

/** A page group as the Rust engine takes it (`card_core::card::PageGroup`). */
export type RustGroup = { pages: { first: number; last: number } } & (
  | { kind: "skip" }
  | { kind: "grid"; grid: GridPayload }
  | { kind: "freeform"; cards: z.infer<typeof OrientedRectSchema>[] }
);

export type PrintRequest = {
  groups: RustGroup[];
  settings: CardSetting[];
  layout: PrintLayoutPayload;
  options: PaginateOptionsPayload;
};

/** Every card of the groups, in page order: the card library. */
export async function computeCards(pages: PageSize[], groups: RustGroup[]): Promise<Card[]> {
  return z.array(CardSchema).parse(await invoke("compute_cards", { pages, groups }));
}

/** The sheets the plan produces, from the same planner the export runs. */
export async function computeSheets(pages: PageSize[], req: PrintRequest): Promise<OutputSheet[]> {
  return z.array(OutputSheetSchema).parse(await invoke("compute_sheets", { pages, ...req }));
}

/** Pre-flight: pages that would make the export fail. Rejects with a message when the plan itself does not work. */
export async function validatePrint(req: PrintRequest): Promise<PageIssue[]> {
  return z.array(PageIssueSchema).parse(await invoke("validate_print", { ...req }));
}

/** Exports the plan from the open PDF. Resolves to the number of sheets written. */
export async function exportPrint(req: PrintRequest, outputPath: string): Promise<number> {
  return invoke<number>("export_print", { ...req, outputPath });
}
