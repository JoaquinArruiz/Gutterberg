// Pre-flight warnings for images (M24): an image that will print soft or blurry at its size. They never stop an
// export; the toolbar lists them next to the errors, apart from them.

import type { OpenDocument } from "../stores/document-store";
import type { ImageQuality } from "./images";

export type ImageWarning = {
  documentId: number;
  page: number;
  name: string;
  quality: ImageQuality | "missing";
  dpi: number;
};

/**
 * The images among `pages` (document id and 0-based page) that print under 300 dpi, or whose file is missing
 * (a blank page). Each page once, in the order given.
 */
export function imageWarnings(
  documents: OpenDocument[],
  pages: { documentId: number; page: number }[],
): ImageWarning[] {
  const out: ImageWarning[] = [];
  const seen = new Set<string>();
  for (const { documentId, page } of pages) {
    const key = `${documentId}:${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const image = documents.find((d) => d.id === documentId)?.images?.pages[page];
    if (!image) continue;
    const name = image.path.split(/[\\/]/).pop() ?? image.path;
    if (image.missing) out.push({ documentId, page, name, quality: "missing", dpi: 0 });
    else if (image.plan && image.plan.quality !== "good")
      out.push({ documentId, page, name, quality: image.plan.quality, dpi: image.plan.dpi });
  }
  return out;
}
