import { useEffect, useState } from "react";
import type { NormalizedRect, Point, Rect } from "./coordinates";
import { renderRegion } from "./tauri";

const REGION_DEBOUNCE_MS = 60;

type RegionImage = { url: string; region: NormalizedRect };

/**
 * A sharp raster of the area around `focus` (normalized), reaching `reachPx`
 * screen px in each direction. Only that crop is rendered, so it is quick and
 * independent of the page size. The crop is re-centred when `focus` drifts a
 * third of the way out of it; the previous image stays until the new one lands,
 * so there is never a blank frame.
 */
export function useRegionImage({
  docKey,
  pageIndex,
  focus,
  pageRect,
  reachPx,
  fullWidthPx,
}: {
  docKey: string | null;
  pageIndex: number;
  focus: Point;
  pageRect: Rect;
  reachPx: number;
  fullWidthPx: number;
}) {
  const [anchor, setAnchor] = useState(focus);
  const [img, setImg] = useState<RegionImage | null>(null);

  const dx = (focus.x - anchor.x) * pageRect.width;
  const dy = (focus.y - anchor.y) * pageRect.height;
  const drifted = Math.hypot(dx, dy) > reachPx / 3;
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on coordinates, not the `focus` object identity
  useEffect(() => {
    if (drifted) setAnchor(focus);
  }, [drifted, focus.x, focus.y]);

  const hx = reachPx / pageRect.width;
  const hy = reachPx / pageRect.height;
  useEffect(() => {
    if (!docKey || fullWidthPx <= 0) return;
    const x0 = Math.max(0, anchor.x - hx);
    const y0 = Math.max(0, anchor.y - hy);
    const region = {
      x: x0,
      y: y0,
      width: Math.min(1, anchor.x + hx) - x0,
      height: Math.min(1, anchor.y + hy) - y0,
    };
    let cancelled = false;
    // Debounced: a pinch or fast drag only renders once it settles; the previous image stays meanwhile.
    const t = setTimeout(() => {
      renderRegion("magnifier", pageIndex, region, fullWidthPx)
        .then((url) => {
          if (cancelled) return URL.revokeObjectURL(url);
          setImg((prev) => {
            if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 1000);
            return { url, region };
          });
        })
        .catch(() => {});
    }, REGION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [docKey, pageIndex, anchor.x, anchor.y, hx, hy, fullWidthPx]);

  // Free the last image on unmount.
  useEffect(
    () => () =>
      setImg((prev) => {
        if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 1000);
        return null;
      }),
    [],
  );

  return img;
}
