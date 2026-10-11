// Cut marks, bleed and duplex backs (M16): the settings the user chooses in the Print inspector and how
// they become the `finishing` the Rust engine takes (`card_core::finish`). Where marks, bleed and backs
// land is decided in Rust; this file only holds the choices and clamps them.

import { z } from "zod";
import { type CardId, freeformCardId, gridCardId } from "./card";
import type { Turn } from "./sheet-api";

export const MARK_STYLES = ["off", "ticks", "gaps"] as const;
export type MarkStyle = (typeof MARK_STYLES)[number];
export const BLEED_SOURCES = ["mirror", "source"] as const;
export type BleedSource = (typeof BLEED_SOURCES)[number];
export const FLIPS = ["long", "short"] as const;
export type Flip = (typeof FLIPS)[number];
/** Where the backs go: on the other side of the paper, or beside each front to fold. */
export const BACK_LAYOUTS = ["duplex", "gutterfold"] as const;
export type BackLayout = (typeof BACK_LAYOUTS)[number];
/** Gutterfold: the back beside its front (vertical fold) or below it (horizontal). */
export const FOLDS = ["vertical", "horizontal"] as const;
export type Fold = (typeof FOLDS)[number];

/** Ranges the engine accepts (mm); the fields clamp to them so Rust never sees a value outside. */
export const MARK_WIDTH_RANGE = [0.05, 2] as const;
export const MARK_LENGTH_RANGE = [1, 10] as const;
export const MARK_OFFSET_RANGE = [0, 10] as const;
export const MAX_BLEED_MM = 5;
export const MAX_DUPLEX_OFFSET_MM = 10;
export const MAX_FOLD_GAP_MM = 5;

export type Finish = {
  marks: { style: MarkStyle; widthMm: number; color: string; lengthMm: number; offsetMm: number };
  bleed: { mm: number; source: BleedSource };
  duplex: {
    on: boolean;
    layout: BackLayout;
    /** Gutterfold only. */
    fold: Fold;
    /** Gutterfold: space between a front and its back, with the fold line in the middle. */
    foldGapMm: number;
    /** Gutterfold: backs a half turn round. Null follows the fold (upside down below the front, upright beside it). */
    backUpsideDown: boolean | null;
    flip: Flip;
    /** Moves every back sheet in the printed sheet; right is positive. */
    offsetXMm: number;
    /** Down is positive. */
    offsetYMm: number;
    /** The piece (by `cardIdKey`) printed behind every piece that has no back of its own. */
    commonBack: string | null;
  };
};

export const DEFAULT_FINISH: Finish = {
  marks: { style: "off", widthMm: 0.25, color: "#000000", lengthMm: 3, offsetMm: 1 },
  bleed: { mm: 0, source: "mirror" },
  duplex: {
    on: false,
    layout: "duplex",
    fold: "vertical",
    foldGapMm: 0,
    backUpsideDown: null,
    flip: "long",
    offsetXMm: 0,
    offsetYMm: 0,
    commonBack: null,
  },
};

export const FinishSchema = z.object({
  marks: z.object({
    style: z.enum(MARK_STYLES),
    widthMm: z.number(),
    color: z.string(),
    lengthMm: z.number(),
    offsetMm: z.number(),
  }),
  bleed: z.object({ mm: z.number(), source: z.enum(BLEED_SOURCES) }),
  duplex: z.object({
    on: z.boolean(),
    layout: z.enum(BACK_LAYOUTS).default("duplex"),
    fold: z.enum(FOLDS).default("vertical"),
    foldGapMm: z.number().default(0),
    backUpsideDown: z.boolean().nullable().default(null),
    flip: z.enum(FLIPS),
    offsetXMm: z.number(),
    offsetYMm: z.number(),
    commonBack: z.string().nullable(),
  }),
});

const clampTo = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;

/** `#rrggbb` in lower case, or the default when `value` is not one. */
export const cleanColor = (value: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_FINISH.marks.color;

/** Piece keys name a document, a page and a place. */
const KEY = /^(?:g:\d+:\d+:\d+:\d+|f:\d+:\d+:\d+)$/;

/** Every value pulled back into what the engine accepts (also for a hand-edited project). */
export function cleanFinish(f: Finish): Finish {
  const d = DEFAULT_FINISH;
  return {
    marks: {
      style: f.marks.style,
      widthMm: clampTo(f.marks.widthMm, ...MARK_WIDTH_RANGE, d.marks.widthMm),
      color: cleanColor(f.marks.color),
      lengthMm: clampTo(f.marks.lengthMm, ...MARK_LENGTH_RANGE, d.marks.lengthMm),
      offsetMm: clampTo(f.marks.offsetMm, ...MARK_OFFSET_RANGE, d.marks.offsetMm),
    },
    bleed: { mm: clampTo(f.bleed.mm, 0, MAX_BLEED_MM, 0), source: f.bleed.source },
    duplex: {
      on: f.duplex.on,
      layout: f.duplex.layout,
      fold: f.duplex.fold,
      foldGapMm: clampTo(f.duplex.foldGapMm, 0, MAX_FOLD_GAP_MM, 0),
      backUpsideDown: f.duplex.backUpsideDown,
      flip: f.duplex.flip,
      offsetXMm: clampTo(f.duplex.offsetXMm, -MAX_DUPLEX_OFFSET_MM, MAX_DUPLEX_OFFSET_MM, 0),
      offsetYMm: clampTo(f.duplex.offsetYMm, -MAX_DUPLEX_OFFSET_MM, MAX_DUPLEX_OFFSET_MM, 0),
      commonBack: f.duplex.commonBack !== null && KEY.test(f.duplex.commonBack) ? f.duplex.commonBack : null,
    },
  };
}

/** The `CardId` a piece key (`cardIdKey`) stands for, or null when it is not one. */
export function parseCardKey(key: string): CardId | null {
  const n = key.split(":").slice(1).map(Number);
  if (n.some((v) => !Number.isInteger(v) || v < 0)) return null;
  if (key.startsWith("g:") && n.length === 4) return gridCardId(n[0], n[1], n[2], n[3]);
  if (key.startsWith("f:") && n.length === 3) return freeformCardId(n[0], n[1], n[2]);
  return null;
}

/** What the Rust command takes (`card_core::finish::Finishing`). */
export type FinishingPayload = {
  options: {
    marks: { style: MarkStyle; width_mm: number; color: string; length_mm: number; offset_mm: number };
    bleed: { mm: number; source: BleedSource };
    duplex: {
      on: boolean;
      layout: BackLayout;
      fold: Fold;
      fold_gap_mm: number;
      back_upside_down: boolean | null;
      flip: Flip;
      offset_x_mm: number;
      offset_y_mm: number;
      common_back: CardId | null;
      common_back_turn: Turn;
    };
  };
  backs: { card: CardId; back: CardId; turn: Turn }[];
};

/**
 * The finishing for a request. `known` are the keys of the pieces that exist: a back that points at a piece
 * that is gone is left out rather than failing the plan. `turns` are the user's turns of the pieces: a back
 * turned in the library is turned that much more on the sheet, so it faces like its front.
 */
export function finishingPayload(
  finish: Finish,
  backs: Record<string, string>,
  known: Set<string>,
  turns: Record<string, Turn> = {},
): FinishingPayload {
  const f = cleanFinish(finish);
  const exists = (k: string | null): k is string => k !== null && known.has(k);
  const common = exists(f.duplex.commonBack) ? parseCardKey(f.duplex.commonBack) : null;
  const pairs: FinishingPayload["backs"] = [];
  for (const [card, back] of Object.entries(backs)) {
    const [from, to] = [parseCardKey(card), parseCardKey(back)];
    if (known.has(card) && known.has(back) && from && to) pairs.push({ card: from, back: to, turn: turns[back] ?? 0 });
  }
  return {
    options: {
      marks: {
        style: f.marks.style,
        width_mm: f.marks.widthMm,
        color: f.marks.color,
        length_mm: f.marks.lengthMm,
        offset_mm: f.marks.offsetMm,
      },
      bleed: f.bleed,
      duplex: {
        on: f.duplex.on,
        layout: f.duplex.layout,
        fold: f.duplex.fold,
        fold_gap_mm: f.duplex.foldGapMm,
        back_upside_down: f.duplex.backUpsideDown,
        flip: f.duplex.flip,
        offset_x_mm: f.duplex.offsetXMm,
        offset_y_mm: f.duplex.offsetYMm,
        common_back: common,
        common_back_turn: common && f.duplex.commonBack ? (turns[f.duplex.commonBack] ?? 0) : 0,
      },
    },
    backs: pairs,
  };
}

/** Codes of `OutputSheet.warnings`, as `card_core::finish::SheetWarning` names them. */
export const SHEET_WARNINGS = [
  "marks_off_page",
  "gap_too_narrow_for_line",
  "bleed_overlaps_neighbour",
  "bleed_off_page",
  "back_size_differs",
  "bleed_exceeds_source_gap",
] as const;
export type SheetWarning = (typeof SHEET_WARNINGS)[number];

/** Whether the backs go beside the fronts, to fold: the plan then needs a sheet grid (not "same as source"). */
export const gutterfoldOn = (f: Finish): boolean => f.duplex.on && f.duplex.layout === "gutterfold";

/** Whether anything of the finishing is switched on. */
export const finishingOn = (f: Finish): boolean => f.marks.style !== "off" || f.bleed.mm > 0 || f.duplex.on;
