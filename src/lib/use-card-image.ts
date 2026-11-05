import { useEffect, useState } from "react";
import { type CardId, cardIdKey, type DocumentId, type OrientedRect, orientedBounds } from "./card";
import type { NormalizedRect } from "./coordinates";
import { ImageCache } from "./image-cache";
import type { PageSize } from "./tauri";
import { type RenderKind, renderRegion } from "./tauri";

const MAX_CARD_IMAGES = 400;
const MAX_FULL_WIDTH_PX = 16384;
/** Pages up to this many pixels on each side are drawn whole once and cut into crops; larger ones crop by region. */
const MAX_SHARED_PAGE_PX = 2048;
/** Decoded whole pages kept to cut more crops from. Few, since each is several megabytes. */
const MAX_SHARED_PAGES = 6;
/** Whole-page widths are rounded up to this step, so pieces of slightly different sizes share one drawing. */
const SHARED_PAGE_STEP_PX = 256;

/** Rendered card crops, shared by the library and the sheet preview, released when the cache is full. */
const cache = new ImageCache(MAX_CARD_IMAGES, (url) => URL.revokeObjectURL(url));

/** Whole pages, decoded, that the crops of their pieces are cut from: one pdfium draw for every piece of a page. */
const pages = new ImageCache<ImageBitmap>(MAX_SHARED_PAGES, (bitmap) => bitmap.close());

/** Forget every card image (a new document was opened). */
export const clearCardImages = () => {
  cache.clear();
  pages.clear();
};

/**
 * The whole-page width to draw a page at so a crop comes out at least `fullWidthPx` wide, or null when that page
 * would be too large to keep (the crop is then rendered on its own).
 */
export function sharedPageWidth(fullWidthPx: number, page: PageSize): number | null {
  const width = Math.ceil(fullWidthPx / SHARED_PAGE_STEP_PX) * SHARED_PAGE_STEP_PX;
  const height = (width * page.height_pt) / page.width_pt;
  return width <= MAX_SHARED_PAGE_PX && height <= MAX_SHARED_PAGE_PX ? width : null;
}

/** The pixels of `region` (normalized) in a picture `width` by `height`, never past its edges. */
export function cropPixels(region: NormalizedRect, width: number, height: number) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(region.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(region.y * height)));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(height, Math.ceil((region.y + region.height) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** The whole page drawn `width` px wide (clear where the page paints nothing), decoded and kept for more crops. */
function sharedPage(docKey: string, kind: RenderKind, documentId: DocumentId, pageIndex: number, width: number) {
  return pages.get(`${docKey}|${documentId}|${pageIndex}|${width}`, async () => {
    const url = await renderRegion(kind, documentId, pageIndex, { x: 0, y: 0, width: 1, height: 1 }, width, true);
    try {
      return await createImageBitmap(await (await fetch(url)).blob());
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

/** Cut `region` out of a decoded page into a PNG blob URL. */
async function cutFrom(bitmap: ImageBitmap, region: NormalizedRect): Promise<string> {
  const r = cropPixels(region, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("could not encode the crop");
  return URL.createObjectURL(blob);
}

/** Widths are rounded up to a step, so small layout changes reuse the image already rendered. */
export const bucketWidth = (px: number) => Math.max(16, Math.ceil(px / 32) * 32);

/**
 * The image of the area a card is cut from, `widthPx` wide (its bounding box if the source is rotated).
 * Null until rendered. `docKey` is the open file, so another PDF never shows the old cards. What the page does not
 * paint is left clear, so whatever is behind the image (white, or the colour behind pieces) shows there.
 */
export function useCardImage(
  docKey: string | null,
  id: CardId,
  source: OrientedRect,
  page: PageSize | undefined,
  widthPx: number,
  kind: RenderKind,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const width = bucketWidth(widthPx);
  const { center, width: w, height: h, angle_deg } = source;
  // The crop's geometry is part of the key: redrawing the region must not show the old image.
  const shape = [center.x, center.y, w, h, angle_deg].map((v) => Math.round(v * 20)).join(",");
  const key = `${docKey}|${cardIdKey(id)}|${shape}|${width}`;

  useEffect(() => {
    if (!docKey || !page || widthPx <= 0) return;
    const box = orientedBounds({ center, width: w, height: h, angle_deg });
    const region = {
      x: Math.max(0, box.x / page.width_pt),
      y: Math.max(0, box.y / page.height_pt),
      width: Math.min(1, box.width / page.width_pt),
      height: Math.min(1, box.height / page.height_pt),
    };
    // The page-wide width at which this crop comes out `width` px wide.
    const fullWidthPx = Math.min(MAX_FULL_WIDTH_PX, Math.round((width * page.width_pt) / box.width));
    let cancelled = false;
    // Small enough? Draw the whole page once and cut every piece of it from that drawing.
    const shared = sharedPageWidth(fullWidthPx, page);
    const render = () =>
      shared === null
        ? renderRegion(kind, id.document_id, id.page_index, region, fullWidthPx, true)
        : sharedPage(docKey, kind, id.document_id, id.page_index, shared)
            .then((b) => cutFrom(b, region))
            // A web view that cannot decode or cut the page still gets the piece, rendered on its own.
            .catch(() => renderRegion(kind, id.document_id, id.page_index, region, fullWidthPx, true));
    cache
      .get(key, render)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, docKey, page, kind, width, center, w, h, angle_deg, id.document_id, id.page_index, widthPx]);

  return docKey ? url : null;
}
