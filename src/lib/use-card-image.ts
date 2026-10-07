import { useEffect, useState } from "react";
import { type CardId, cardIdKey, type OrientedRect, orientedBounds } from "./card";
import { ImageCache } from "./image-cache";
import type { PageSize } from "./tauri";
import { type RenderKind, renderRegion } from "./tauri";

const MAX_CARD_IMAGES = 400;
const MAX_FULL_WIDTH_PX = 16384;

/** Rendered card crops, shared by the library and the sheet preview, released when the cache is full. */
const cache = new ImageCache(MAX_CARD_IMAGES, (url) => URL.revokeObjectURL(url));

/** Forget every card image (a new document was opened). */
export const clearCardImages = () => cache.clear();

/** Widths are rounded up to a step, so small layout changes reuse the image already rendered. */
export const bucketWidth = (px: number) => Math.max(16, Math.ceil(px / 32) * 32);

/**
 * The image of the area a card is cut from, `widthPx` wide (its bounding box if the source is rotated).
 * Null until rendered. `docKey` is the open file, so another PDF never shows the old cards.
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
    cache
      .get(key, () => renderRegion(kind, id.page_index, region, fullWidthPx))
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, docKey, page, kind, width, center, w, h, angle_deg, id.page_index, widthPx]);

  return docKey ? url : null;
}
