import { useEffect, useRef, useState } from "react";
import type { NormalizedRect, Rect, Size } from "./coordinates";
import { renderRegion } from "./tauri";
import { covers, planCrop, scaleIsOk } from "./view-region";

export type ViewportImage = { url: string; region: NormalizedRect; fullWidthPx: number; key: string };

/**
 * Sharp raster of just the on-screen part of the page, for when the page is
 * zoomed past what the full-page base layer can supply. The previous image
 * stays (and keeps tracking the page) until a new one lands, and a render is
 * only requested when the view has left the rendered crop or the zoom has
 * changed a lot.
 *
 * At most ONE render is in flight: the backend serialises pdfium calls and
 * cannot cancel one that is queued, so firing a request per zoom/pan event
 * would queue them all (and delay everything else, e.g. the magnifier).
 */
export function useViewportImage({
  docKey,
  pageIndex,
  pageRect,
  box,
  dpr,
  enabled,
  debounceMs = 120,
}: {
  docKey: string | null;
  pageIndex: number;
  pageRect: Rect;
  box: Size;
  dpr: number;
  enabled: boolean;
  debounceMs?: number;
}) {
  const [img, setImg] = useState<ViewportImage | null>(null);
  const [tick, setTick] = useState(0); // bumped when a render finishes, to re-evaluate
  const imgRef = useRef(img);
  imgRef.current = img;
  const inflight = useRef(false);
  const failed = useRef<string | null>(null);
  const key = `${docKey}:${pageIndex}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Free the last image on unmount.
      const last = imgRef.current;
      if (last) setTimeout(() => URL.revokeObjectURL(last.url), 1000);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: depends on the rect/box numbers, not object identity; `tick` re-runs it after a render completes
  useEffect(() => {
    if (!enabled || !docKey) {
      const cur = imgRef.current;
      if (cur) {
        setTimeout(() => URL.revokeObjectURL(cur.url), 1000);
        setImg(null);
      }
      return;
    }
    const plan = planCrop(pageRect, box, dpr);
    if (!plan) return;
    const cur = imgRef.current;
    if (cur && cur.key === key && covers(cur.region, pageRect, box) && scaleIsOk(cur.fullWidthPx, plan.fullWidthPx)) {
      return; // what we have still does the job
    }
    const signature = `${key}:${plan.fullWidthPx}:${plan.send.x}:${plan.send.y}:${plan.send.width}:${plan.send.height}`;
    if (failed.current === signature) return; // don't hammer a request that already failed

    const t = setTimeout(() => {
      if (inflight.current) return; // the running render's completion bumps `tick` and re-evaluates
      inflight.current = true;
      renderRegion(pageIndex, plan.send, plan.fullWidthPx)
        .then((url) => {
          if (!alive.current || keyRef.current !== key) return URL.revokeObjectURL(url);
          setImg((prev) => {
            if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 1000);
            return { url, region: plan.region, fullWidthPx: plan.fullWidthPx, key };
          });
        })
        .catch(() => {
          failed.current = signature;
        })
        .finally(() => {
          inflight.current = false;
          if (alive.current) setTick((n) => n + 1);
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [
    enabled,
    docKey,
    pageIndex,
    key,
    dpr,
    debounceMs,
    tick,
    pageRect.x,
    pageRect.y,
    pageRect.width,
    pageRect.height,
    box.width,
    box.height,
  ]);

  // Only ever show an image that belongs to the current document/page.
  return img && img.key === key && enabled ? img : null;
}
