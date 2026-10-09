// The project file (.gtr): everything the app needs to come back as it was, except the PDFs themselves.
//
// The envelope (`format`, `version`) is checked and migrated in Rust (`card_core::project`) before this
// file sees the data; this file describes the rest and checks it again with Zod, so a hand-edited or
// damaged file is refused here instead of breaking a store. The data is the UI's own model (camelCase,
// normalized coordinates): it is saved as it is held, and the Rust engine is asked to do the maths from it
// as always.

import { z } from "zod";
import type { OutputSettings } from "../stores/layout-store";
import { MAX_MARGIN_MM } from "../stores/layout-store";
import { type DocumentId, OrientedRectSchema } from "./card";
import { type CardEdits, clampScale } from "./card-edits";
import { type FreeformCards, type GridGroup, MAX_GAP_MM, type PageGroup, patchGrid } from "./document-layout";
import { cleanFinish, FinishSchema } from "./finish";
import { ImagePlacementSchema } from "./images";
import { clampQuantity } from "./library";
import { MAX_SHEET_GRID, type PrintPlan } from "./print-request";
import { TurnSchema } from "./sheet-api";

/** Value of the `format` key: the file's signature. Kept in step with `card_core::project::FORMAT`. */
export const PROJECT_FORMAT = "gutterberg-project";
/** The version this build writes. Older ones are migrated in Rust before they get here. */
export const PROJECT_VERSION = 3;
export const PROJECT_EXTENSION = "gtr";

const finite = z.number();
const index = z.number().int().min(0);
const NormalizedRectSchema = z.object({ x: finite, y: finite, width: finite, height: finite });
const PageRangeSchema = z.object({ first: index, last: index });

const GroupGridSchema = z.object({
  rows: z.number().int().min(1),
  columns: z.number().int().min(1),
  sourceGapXMm: finite,
  sourceGapYMm: finite,
  sourceGapLinked: z.boolean(),
});

const PageGroupSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("grid"),
    pages: PageRangeSchema,
    grid: GroupGridSchema,
    selection: NormalizedRectSchema.nullable(),
  }),
  z.object({ kind: z.literal("skip"), pages: PageRangeSchema }),
]);

/** Keys are page numbers, as JSON object keys always are. */
const FreeformSchema = z.record(z.string().regex(/^\d+$/), z.array(OrientedRectSchema));

const OutputSchema = z.object({
  gapXMm: finite,
  gapYMm: finite,
  gapLinked: z.boolean(),
  pageMode: z.enum(["same", "a4", "letter", "legal", "custom", "fit"]),
  orientation: z.enum(["portrait", "landscape"]),
  customWidthMm: finite,
  customHeightMm: finite,
  margins: z.object({ top: finite, right: finite, bottom: finite, left: finite }),
});

const EditsSchema = z.object({
  turns: z.record(z.string(), TurnSchema),
  scales: z.record(z.string(), finite),
  order: z.array(z.string()),
  backs: z.record(z.string(), z.string()),
});

const PlanSchema = z.object({
  mode: z.enum(["all", "custom"]),
  quantities: z.record(z.string(), z.number().int()),
  autoFill: z.boolean(),
  order: z.enum(["grouped", "interleaved"]),
  groupBySize: z.boolean(),
  sheetGrid: z.enum(["same", "auto", "custom"]),
  rows: z.number().int(),
  columns: z.number().int(),
  finish: FinishSchema,
});

const DocumentBaseSchema = z.object({
  /** The id its pieces carry; stays the same for as long as the project exists. */
  id: z.number().int().min(0),
  pageCount: z.number().int().min(1),
  groups: z.array(PageGroupSchema),
  freeform: FreeformSchema,
  /** The page that was being viewed. */
  viewedPage: index,
});

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** An image of an images document: where it was, which file it was, and how it was placed. */
const ProjectImageSchema = z.object({ path: z.string().min(1), hash: HashSchema, placement: ImagePlacementSchema });

const ProjectDocumentSchema = z.discriminatedUnion("kind", [
  DocumentBaseSchema.extend({
    kind: z.literal("pdf"),
    /** Where the PDF was when the project was saved. */
    path: z.string().min(1),
    /** SHA-256 of the PDF (hex) when it was added: tells whether it is still the same file. */
    hash: HashSchema,
  }),
  // The project keeps the images, one per page; the PDF made of them is rebuilt from them (M24).
  DocumentBaseSchema.extend({
    kind: z.literal("images"),
    name: z.string().min(1),
    images: z.array(ProjectImageSchema).min(1),
  }).refine((d) => d.images.length === d.pageCount, { message: "an image for each page", path: ["images"] }),
]);

export const ProjectSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    version: z.literal(PROJECT_VERSION),
    documents: z.array(ProjectDocumentSchema).min(1),
    activeDocument: z.number().int().min(0),
    output: OutputSchema,
    edits: EditsSchema,
    plan: PlanSchema,
  })
  .superRefine((p, ctx) => {
    const ids = p.documents.map((d) => d.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "two documents have the same id", path: ["documents"] });
    if (!ids.includes(p.activeDocument))
      ctx.addIssue({ code: "custom", message: "the active document is not in the project", path: ["activeDocument"] });
  });

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectDocument = Project["documents"][number];

type DocumentStateBase = {
  id: DocumentId;
  pageCount: number;
  groups: PageGroup[];
  freeform: FreeformCards;
  viewedPage: number;
};

/** One PDF of the project as the app holds it. */
export type PdfDocumentState = DocumentStateBase & { kind: "pdf"; path: string; hash: string };

/** One images document: what the project keeps of it (the cached PDF is not part of it). */
export type ImagesDocumentState = DocumentStateBase & {
  kind: "images";
  name: string;
  images: ProjectImage[];
};

export type ProjectImage = z.infer<typeof ProjectImageSchema>;
export type ProjectDocumentState = PdfDocumentState | ImagesDocumentState;

/** Everything a project file holds, in the app's own types. */
export type ProjectState = {
  documents: ProjectDocumentState[];
  activeId: DocumentId;
  output: OutputSettings;
  edits: CardEdits;
  plan: PrintPlan;
};

/** The state as a project file's content (without the envelope keys, which Rust writes first). */
export function toProject(state: ProjectState): Omit<Project, "format" | "version"> {
  return {
    documents: state.documents.map((d) => {
      const { kind, id, pageCount, groups, freeform, viewedPage } = d;
      return kind === "pdf"
        ? { kind, id, path: d.path, hash: d.hash, pageCount, groups, freeform, viewedPage }
        : { kind, id, name: d.name, images: d.images, pageCount, groups, freeform, viewedPage };
    }),
    activeDocument: state.activeId,
    output: state.output,
    edits: state.edits,
    plan: state.plan,
  };
}

/**
 * The text a change is compared by: equal while nothing was edited since the last save or open. The page
 * being viewed is left out, because turning pages is not editing.
 */
export const projectSignature = (state: ProjectState): string =>
  JSON.stringify(toProject({ ...state, documents: state.documents.map((d) => ({ ...d, viewedPage: 0 })) }));

/** Whether `groups` cover pages 0..pageCount-1 in order with no gaps or overlaps. */
export function groupsCoverPages(groups: PageGroup[], pageCount: number): boolean {
  let next = 0;
  for (const g of groups) {
    if (g.pages.first !== next || g.pages.last < g.pages.first) return false;
    next = g.pages.last + 1;
  }
  return next === pageCount;
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function cleanGroup(g: z.infer<typeof PageGroupSchema>): PageGroup {
  if (g.kind === "skip") return g;
  const grid: GridGroup["grid"] = patchGrid(g.grid, {
    rows: g.grid.rows,
    columns: g.grid.columns,
    sourceGapXMm: g.grid.sourceGapXMm,
    sourceGapYMm: g.grid.sourceGapYMm,
    sourceGapLinked: g.grid.sourceGapLinked,
  });
  return { ...g, grid };
}

/** An image's placement pulled back to sizes the dialog allows. */
function cleanImage(i: ProjectImage): ProjectImage {
  const mm = (v: number, lo: number, hi: number) => clampTo(v, lo, hi);
  const p = i.placement;
  return {
    ...i,
    placement: {
      ...p,
      widthMm: mm(p.widthMm, 5, 1000),
      heightMm: mm(p.heightMm, 5, 1000),
      bleedMm: mm(p.bleedMm, 0, 20),
    },
  };
}

/** Values a hand-edited file could push out of range, pulled back to what the UI allows. */
function cleanOutput(o: z.infer<typeof OutputSchema>): OutputSettings {
  const gap = (mm: number) => clampTo(mm, 0, MAX_GAP_MM);
  const margin = (mm: number) => clampTo(mm, 0, MAX_MARGIN_MM);
  return {
    ...o,
    gapXMm: gap(o.gapXMm),
    gapYMm: o.gapLinked ? gap(o.gapXMm) : gap(o.gapYMm),
    customWidthMm: Math.max(o.customWidthMm, 10),
    customHeightMm: Math.max(o.customHeightMm, 10),
    margins: {
      top: margin(o.margins.top),
      right: margin(o.margins.right),
      bottom: margin(o.margins.bottom),
      left: margin(o.margins.left),
    },
  };
}

function cleanPlan(p: z.infer<typeof PlanSchema>): PrintPlan {
  const quantities: Record<string, number> = {};
  for (const [k, n] of Object.entries(p.quantities)) {
    const q = clampQuantity(n);
    if (q > 0) quantities[k] = q;
  }
  return {
    ...p,
    quantities,
    rows: clampTo(p.rows, 1, MAX_SHEET_GRID),
    columns: clampTo(p.columns, 1, MAX_SHEET_GRID),
    finish: cleanFinish(p.finish),
  };
}

/** Piece keys name a document, a page and a place; only keys of this shape are kept. */
const KEY = /^(?:g:\d+:\d+:\d+:\d+|f:\d+:\d+:\d+)$/;

function cleanEdits(e: z.infer<typeof EditsSchema>): CardEdits {
  const keep = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => KEY.test(k)));
  const scales: Record<string, number> = {};
  for (const [k, s] of Object.entries(keep(e.scales))) scales[k] = clampScale(s);
  const backs = Object.fromEntries(Object.entries(e.backs).filter(([k, v]) => KEY.test(k) && KEY.test(v) && k !== v));
  return { turns: keep(e.turns), scales, order: e.order.filter((k) => KEY.test(k)), backs };
}

/** Parses the content of a project file. Throws a `ZodError` when it is not a project this build understands. */
export function parseProject(raw: unknown): Project {
  return ProjectSchema.parse(raw);
}

/** A parsed project in the app's own types, with every value inside what the UI allows. */
export function fromProject(p: Project): ProjectState {
  return {
    documents: p.documents.map((d): ProjectDocumentState => {
      const common = {
        id: d.id,
        pageCount: d.pageCount,
        groups: d.groups.map(cleanGroup),
        freeform: Object.fromEntries(Object.entries(d.freeform).map(([page, cards]) => [Number(page), cards])),
        viewedPage: d.viewedPage,
      };
      return d.kind === "pdf"
        ? { kind: "pdf", path: d.path, hash: d.hash, ...common }
        : { kind: "images", name: d.name, images: d.images.map(cleanImage), ...common };
    }),
    activeId: p.activeDocument,
    output: cleanOutput(p.output),
    edits: cleanEdits(p.edits),
    plan: cleanPlan(p.plan),
  };
}
