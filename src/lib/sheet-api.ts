// IPC for the print stage. Mirrors card_core::sheet (serde, snake_case); every layout decision is
// made by the Rust engine, this file only describes the requests and parses the answers.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { OutputSettings } from "../stores/layout-store";
import { CardIdSchema, type DocumentId, OrientedRectSchema } from "./card";
import { BLEED_SOURCES, MARK_LINES, SHEET_WARNINGS } from "./finish";
import { type LayoutDocument, outputSettings, type PrintProject, printDocuments } from "./print-request";
import type { PageIssue, PageSize } from "./tauri";
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
  /** The factor along the card's height when set apart from its width; absent or null = `scale`. */
  scale_y: z.number().nullish(),
  turn: TurnSchema,
});
export type Card = z.infer<typeof CardSchema>;

export const SheetPlacementSchema = z.object({
  card_id: CardIdSchema,
  source: OrientedRectSchema,
  destination: RectSchema,
  turn: TurnSchema,
  scale: z.number(),
  scale_y: z.number().nullish(),
});
export type SheetPlacement = z.infer<typeof SheetPlacementSchema>;

export const OutputSheetSchema = z.object({
  page: PageSizeSchema,
  placements: z.array(SheetPlacementSchema),
  /** A sheet is a front unless duplex is on (M16). */
  side: z.enum(["front", "back"]).optional(),
  /** Art painted outside each piece; absent or 0 = none. */
  bleed: z.object({ mm: z.number(), source: z.enum(BLEED_SOURCES).optional() }).optional(),
  /** Edge bleed: a plain fill of `color` (RGB) under placement `placement`, grown by the bleed. */
  edge_fills: z
    .array(z.object({ placement: z.number(), color: z.tuple([z.number(), z.number(), z.number()]) }))
    .optional(),
  /** Plain colours as RGB, painted under the bleed and the pieces; absent = none. */
  background: z
    .object({
      sheet: z.tuple([z.number(), z.number(), z.number()]).optional(),
      pieces: z.tuple([z.number(), z.number(), z.number()]).optional(),
    })
    .optional(),
  /** Cut marks in points: `[x1, y1, x2, y2]` per line. */
  marks: z
    .object({
      width_pt: z.number(),
      color: z.tuple([z.number(), z.number(), z.number()]),
      line: z.enum(MARK_LINES).optional(),
      /** On and off lengths in points; empty or absent = solid. */
      dash: z.array(z.number()).optional(),
      lines: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
    })
    .nullish(),
  warnings: z.array(z.enum(SHEET_WARNINGS)).optional(),
  /** Gutterfold fold lines in points: `[x1, y1, x2, y2]` per pair. */
  folds: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(),
});
export type OutputSheet = z.infer<typeof OutputSheetSchema>;

/** Every card of the documents' groups, in page order, one document after the other: the piece library. */
export async function computeCards(documents: LayoutDocument[], output: OutputSettings): Promise<Card[]> {
  return z.array(CardSchema).parse(
    await invoke("compute_cards", {
      documents: printDocuments(documents),
      output: outputSettings(output),
      pages: Object.fromEntries(documents.map((d) => [d.id, d.pages])),
    }),
  );
}

/**
 * The sheets the plan produces, from the same request and planner the export runs. `pages` are the sizes by document
 * id, as shown.
 */
export async function computeSheets(
  project: PrintProject,
  pages: Record<DocumentId, PageSize[]>,
): Promise<OutputSheet[]> {
  return z.array(OutputSheetSchema).parse(await invoke("compute_sheets", { project, pages }));
}

/** Pre-flight: pages that would make the export fail. Rejects with a message when the plan itself does not work. */
export async function validatePrint(
  project: PrintProject,
  pages: Record<DocumentId, PageSize[]>,
): Promise<PageIssue[]> {
  return z.array(PageIssueSchema).parse(await invoke("validate_print", { project, pages }));
}

/** Exports the plan from the project's PDFs. Resolves to the number of sheets written. */
export async function exportPrint(
  project: PrintProject,
  pages: Record<DocumentId, PageSize[]>,
  outputPath: string,
): Promise<number> {
  return invoke<number>("export_print", { project, pages, outputPath });
}
