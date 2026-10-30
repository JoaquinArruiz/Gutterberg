// Cut marks, bleed and duplex backs (M16): the settings the user chooses in the Print inspector and how
// they become the `finishing` the Rust engine takes (`card_core::finish`). Where marks, bleed and backs
// land is decided in Rust; this file only holds the choices and clamps them.

import { z } from "zod";
import { CARD_KEY } from "./card";

export const MARK_STYLES = ["off", "ticks", "gaps"] as const;
export type MarkStyle = (typeof MARK_STYLES)[number];
/** How a cut mark is stroked. */
export const MARK_LINES = ["solid", "dashed", "dotted"] as const;
export type MarkLine = (typeof MARK_LINES)[number];
export const BLEED_SOURCES = ["mirror", "source", "edge", "ai"] as const;
export type BleedSource = (typeof BLEED_SOURCES)[number];
export const FLIPS = ["long", "short"] as const;
export type Flip = (typeof FLIPS)[number];
/** Where the backs go: on the other side of the paper, or beside each front to fold. */
export const BACK_LAYOUTS = ["duplex", "gutterfold"] as const;
export type BackLayout = (typeof BACK_LAYOUTS)[number];
/** Gutterfold: the back beside its front (vertical fold) or below it (horizontal). */
export const FOLDS = ["vertical", "horizontal"] as const;
export type Fold = (typeof FOLDS)[number];
export const COLOR_MODES = ["rgb", "cmyk"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** Ranges the engine accepts (mm); the fields clamp to them so Rust never sees a value outside. */
export const MARK_WIDTH_RANGE = [0.05, 2] as const;
export const MARK_LENGTH_RANGE = [1, 10] as const;
export const MARK_OFFSET_RANGE = [0, 10] as const;
export const MAX_BLEED_MM = 5;
export const MAX_DUPLEX_OFFSET_MM = 10;
export const MAX_FOLD_GAP_MM = 5;

/** A picture of Fill with AI, as the project lists it. */
export type AiFill = { file: string; inset: number };

/** A fill's file name: plain, in the fills folder (`card_core::fill::fill_name`). */
const FILL_FILE = /^[A-Za-z0-9-]+\.png$/;

export type Finish = {
  marks: {
    style: MarkStyle;
    line: MarkLine;
    widthMm: number;
    color: string;
    lengthMm: number;
    offsetMm: number;
    /** Duplex on the other side: marks on the back sheets too, for backs cut on their own. */
    onBacks: boolean;
    /** Ticks: also a cross where a gap between columns meets a gap between rows. */
    innerCrosses: boolean;
  };
  bleed: {
    mm: number;
    source: BleedSource;
    /** Edge: the colour (`#rrggbb`) of each piece's edge, by `cardIdKey`, found from a small render
     * (`useEdgeColors`). A piece without one is mirrored. */
    edgeColors: Record<string, string>;
    /** Fill with AI: the picture of each piece's band (`file`, in the project's fills folder) and the band's width
     * in it (`inset`, px), by `cardIdKey`. A piece without one, or whose file is gone, is mirrored. */
    aiFills: Record<string, AiFill>;
  };
  duplex: {
    on: boolean;
    layout: BackLayout;
    /** Gutterfold only. */
    fold: Fold;
    /** Gutterfold: space between a front and its back, with the fold line in the middle. */
    foldGapMm: number;
    /** Gutterfold: the pairs are cut apart instead of folded (no fold line, marks between front and back). */
    cutApart: boolean;
    /** Gutterfold: backs a half turn round. Null follows the fold (upside down below the front, upright beside it
     * or when cut apart). */
    backUpsideDown: boolean | null;
    flip: Flip;
    /** Moves every back sheet in the printed sheet; right is positive. */
    offsetXMm: number;
    /** Down is positive. */
    offsetYMm: number;
    /** The piece (by `cardIdKey`) printed behind every piece that has no back of its own. */
    commonBack: string | null;
  };
  /** Plain colours (`#rrggbb`) under everything: the whole sheet, and behind each piece and its bleed. They show
   * only where the source leaves the page empty. Null paints nothing, so the paper shows. */
  background: { sheet: string | null; pieces: string | null };
  /** How the export writes the colours the app draws (marks, fills) and the pictures it put in the file (images,
   * Fill with AI): RGB, or CMYK for a print shop. The sources keep their own colours either way. */
  colors: ColorMode;
};

export const DEFAULT_FINISH: Finish = {
  marks: {
    style: "off",
    line: "solid",
    widthMm: 0.25,
    color: "#000000",
    lengthMm: 3,
    offsetMm: 1,
    onBacks: false,
    innerCrosses: false,
  },
  bleed: { mm: 0, source: "mirror", edgeColors: {}, aiFills: {} },
  duplex: {
    on: false,
    layout: "duplex",
    fold: "vertical",
    foldGapMm: 0,
    cutApart: false,
    backUpsideDown: null,
    flip: "long",
    offsetXMm: 0,
    offsetYMm: 0,
    commonBack: null,
  },
  background: { sheet: null, pieces: null },
  colors: "rgb",
};

export const FinishSchema = z.object({
  marks: z.object({
    style: z.enum(MARK_STYLES),
    line: z.enum(MARK_LINES).default("solid"),
    widthMm: z.number(),
    color: z.string(),
    lengthMm: z.number(),
    offsetMm: z.number(),
    onBacks: z.boolean().default(false),
    innerCrosses: z.boolean().default(false),
  }),
  bleed: z.object({
    mm: z.number(),
    source: z.enum(BLEED_SOURCES),
    edgeColors: z.record(z.string(), z.string()).default({}),
    aiFills: z.record(z.string(), z.object({ file: z.string(), inset: z.number() })).default({}),
  }),
  duplex: z.object({
    on: z.boolean(),
    layout: z.enum(BACK_LAYOUTS).default("duplex"),
    fold: z.enum(FOLDS).default("vertical"),
    foldGapMm: z.number().default(0),
    cutApart: z.boolean().default(false),
    backUpsideDown: z.boolean().nullable().default(null),
    flip: z.enum(FLIPS),
    offsetXMm: z.number(),
    offsetYMm: z.number(),
    commonBack: z.string().nullable(),
  }),
  background: z
    .object({ sheet: z.string().nullable(), pieces: z.string().nullable() })
    .default({ sheet: null, pieces: null }),
  colors: z.enum(COLOR_MODES).default("rgb"),
});

const clampTo = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;

/** `#rrggbb` in lower case, or the default when `value` is not one. */
export const cleanColor = (value: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_FINISH.marks.color;

/** `#rrggbb` in lower case, or null (no fill) when `value` is not one. */
const cleanFill = (value: string | null): string | null =>
  value !== null && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;

/** Piece keys name a document, a page and a place; only keys of this shape are kept. */
const KEY = CARD_KEY;

/** Every value pulled back into what the engine accepts (also for a hand-edited project). */
export function cleanFinish(f: Finish): Finish {
  const d = DEFAULT_FINISH;
  return {
    marks: {
      style: f.marks.style,
      line: f.marks.line,
      widthMm: clampTo(f.marks.widthMm, ...MARK_WIDTH_RANGE, d.marks.widthMm),
      color: cleanColor(f.marks.color),
      lengthMm: clampTo(f.marks.lengthMm, ...MARK_LENGTH_RANGE, d.marks.lengthMm),
      offsetMm: clampTo(f.marks.offsetMm, ...MARK_OFFSET_RANGE, d.marks.offsetMm),
      onBacks: f.marks.onBacks,
      innerCrosses: f.marks.innerCrosses,
    },
    bleed: {
      mm: clampTo(f.bleed.mm, 0, MAX_BLEED_MM, 0),
      source: f.bleed.source,
      edgeColors: Object.fromEntries(
        Object.entries(f.bleed.edgeColors).flatMap(([k, c]) => {
          const color = cleanFill(c);
          return KEY.test(k) && color !== null ? [[k, color]] : [];
        }),
      ),
      aiFills: Object.fromEntries(
        Object.entries(f.bleed.aiFills).filter(
          ([k, a]) => KEY.test(k) && FILL_FILE.test(a.file) && Number.isInteger(a.inset) && a.inset > 0,
        ),
      ),
    },
    duplex: {
      on: f.duplex.on,
      layout: f.duplex.layout,
      fold: f.duplex.fold,
      foldGapMm: clampTo(f.duplex.foldGapMm, 0, MAX_FOLD_GAP_MM, 0),
      cutApart: f.duplex.cutApart,
      backUpsideDown: f.duplex.backUpsideDown,
      flip: f.duplex.flip,
      offsetXMm: clampTo(f.duplex.offsetXMm, -MAX_DUPLEX_OFFSET_MM, MAX_DUPLEX_OFFSET_MM, 0),
      offsetYMm: clampTo(f.duplex.offsetYMm, -MAX_DUPLEX_OFFSET_MM, MAX_DUPLEX_OFFSET_MM, 0),
      commonBack: f.duplex.commonBack !== null && KEY.test(f.duplex.commonBack) ? f.duplex.commonBack : null,
    },
    background: { sheet: cleanFill(f.background.sheet), pieces: cleanFill(f.background.pieces) },
    colors: COLOR_MODES.includes(f.colors) ? f.colors : "rgb",
  };
}

/** The file names of the project's AI fills. */
export const fillFiles = (f: Finish): string[] => Object.values(f.bleed.aiFills).map((a) => a.file);

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

/** A sheet's background colour (RGB, as the engine returns it) for CSS; `fallback` when there is none. */
export const fillCss = (rgb: readonly number[] | undefined, fallback = "white"): string =>
  rgb ? `rgb(${rgb.join(" ")})` : fallback;

/** Whether the backs go beside the fronts, to fold: the plan then needs a sheet grid (not "same as source"). */
export const gutterfoldOn = (f: Finish): boolean => f.duplex.on && f.duplex.layout === "gutterfold";

/** Whether anything of the finishing is switched on. */
export const finishingOn = (f: Finish): boolean =>
  f.marks.style !== "off" ||
  f.bleed.mm > 0 ||
  f.duplex.on ||
  f.background.sheet !== null ||
  f.background.pieces !== null;
