// IPC for detecting pieces (M17). Mirrors `card_core::detect` (serde, snake_case); the engines run in
// Rust, this file only describes the answer. Geometry arrives in points of the page as displayed,
// top-left origin; `detect.ts` turns it into the UI's normalized coordinates.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { type DocumentId, OrientedRectSchema } from "./card";

const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** Things worth telling the user about a proposal (or, when there is none, why). */
export const NOTES = [
  "missing_cells",
  "crop_marks",
  "few_objects",
  "uneven_sizes",
  "touches_edge",
  "one_piece",
  "merged_pieces",
  "no_regular_pattern",
] as const;
export const NoteSchema = z.enum(NOTES);
export type Note = z.infer<typeof NoteSchema>;

const Common = { confidence: z.number(), engine: z.string(), notes: z.array(NoteSchema).default([]) };

export const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("grid"),
    /** The outer box of all the pieces, gaps included, in points. */
    bounds: RectSchema,
    rows: z.number().int().min(1),
    columns: z.number().int().min(1),
    source_gap_x_mm: z.number(),
    source_gap_y_mm: z.number(),
    ...Common,
  }),
  z.object({ kind: z.literal("rects"), rects: z.array(OrientedRectSchema), ...Common }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

export const DetectionSchema = z.object({
  proposals: z.array(ProposalSchema),
  reasons: z.array(NoteSchema).default([]),
});
export type Detection = z.infer<typeof DetectionSchema>;

/** Where the pieces seem to be on a page of an open PDF, best proposal first. Applies nothing. */
export async function detectPieces(documentId: DocumentId, pageIndex: number): Promise<Detection> {
  return DetectionSchema.parse(await invoke("detect_pieces", { documentId, pageIndex }));
}
