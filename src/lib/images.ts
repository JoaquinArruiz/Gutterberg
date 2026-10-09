// Images as pieces (M24): the types shared with the Rust engine (`card_core::images`), the calls to it and
// the small pieces of logic around an import. The engine turns the images into a one-page-per-image PDF
// kept in the app's cache; from then on that PDF is a document like any other.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { z } from "zod";
import { t } from "../i18n";
import type { NormalizedRect } from "./coordinates";
import type { GridGroup, PageGroup } from "./document-layout";

/** The formats an import accepts; anything else is refused with a message naming the file. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export const isImagePath = (path: string): boolean => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
};

/** Mirrors `card_core::images::Placement`. */
export const ImagePlacementSchema = z.object({
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  bleedMm: z.number().min(0),
  fit: z.enum(["fit", "fill"]),
  reduceLarge: z.boolean(),
});
export type ImagePlacement = z.infer<typeof ImagePlacementSchema>;

/** Mirrors `card_core::images::ImageProbe`. */
export const ImageProbeSchema = z.object({
  path: z.string(),
  name: z.string(),
  format: z.enum(["jpeg", "png", "webp"]),
  widthPx: z.number().int(),
  heightPx: z.number().int(),
  dpi: z.number().nullable(),
  nativeWidthMm: z.number().nullable(),
  nativeHeightMm: z.number().nullable(),
  bytes: z.number(),
  hash: z.string(),
  storedBytes: z.number(),
});
export type ImageProbe = z.infer<typeof ImageProbeSchema>;

export const ImageQualitySchema = z.enum(["good", "soft", "blurry"]);
export type ImageQuality = z.infer<typeof ImageQualitySchema>;

/** Mirrors `card_core::images::ImagePlan`. */
export const ImagePlanSchema = z.object({
  pageWidthMm: z.number(),
  pageHeightMm: z.number(),
  piece: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  proportionsDiffer: z.boolean(),
  dpi: z.number(),
  quality: ImageQualitySchema,
  veryLarge: z.boolean(),
  reducedToDpi: z.number().nullable(),
  storedBytes: z.number(),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

/** Mirrors `card_core::images::ImageSpec`: one page of an images document. */
export type ImageSpec = { path: string; hash: string; placement: ImagePlacement; missing?: boolean };

/** One page of an images document as the app holds it. `plan` is null for an image that is missing. */
export type ImagePageInfo = {
  path: string;
  hash: string;
  placement: ImagePlacement;
  plan: ImagePlan | null;
  missing: boolean;
};

/** What an images document is made of; the document's `path` is the cached PDF built from it. */
export type ImagesInfo = { name: string; pages: ImagePageInfo[] };

/** One file of an import: what the engine found, or why it cannot be used. */
export type ProbeOutcome = { path: string; probe: ImageProbe | null; error: unknown };

const ProbeOutcomeSchema = z.object({
  path: z.string(),
  probe: ImageProbeSchema.nullable(),
  error: z.unknown(),
});

export async function probeImages(paths: string[]): Promise<ProbeOutcome[]> {
  return z.array(ProbeOutcomeSchema).parse(await invoke("probe_images", { paths }));
}

/** What each placement does to its image. The engine does the maths; the dialog only shows it. */
export async function planImages(requests: { probe: ImageProbe; placement: ImagePlacement }[]): Promise<ImagePlan[]> {
  if (requests.length === 0) return [];
  return z.array(ImagePlanSchema).parse(await invoke("plan_images", { requests }));
}

/** The path of the cached PDF made of these images (built when it is not there yet). */
export async function buildImagesDocument(specs: ImageSpec[]): Promise<string> {
  return z.string().parse(await invoke("build_images_document", { specs }));
}

export async function pickImages(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: t("files.imageFilter"), extensions: [...IMAGE_EXTENSIONS] }],
  });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

/** The size presets of the dialog, in mm. */
export const SIZE_PRESETS = {
  standard: { widthMm: 63, heightMm: 88 },
  small: { widthMm: 59, heightMm: 86 },
  tarot: { widthMm: 70, heightMm: 120 },
} as const;

export type SizePreset = keyof typeof SIZE_PRESETS | "image" | "custom";

export const DEFAULT_BLEED_MM = 3;

/** Bytes as "28 MB" / "640 KB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The name of a new images document: the first image's, and how many others there are. */
export function imagesDocumentName(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return t("images.documentName", { first: names[0], count: names.length - 1 });
}

/**
 * The page groups of an images document: one grid over every page, 1 × 1, covering the piece. With bleed the
 * piece is the middle of the page, so "bleed from the source" (M16) uses the image's own bleed.
 */
export function imageGroups(pageCount: number, piece: NormalizedRect): PageGroup[] {
  if (pageCount <= 0) return [];
  const group: GridGroup = {
    kind: "grid",
    pages: { first: 0, last: pageCount - 1 },
    grid: { rows: 1, columns: 1, sourceGapXMm: 0, sourceGapYMm: 0, sourceGapLinked: true },
    selection: piece,
  };
  return [group];
}

/** Whether an image prints worse than it should at its size: a note under 300 dpi, a warning under 150. */
export const needsAttention = (plan: ImagePlan | null): boolean => plan !== null && plan.quality !== "good";
