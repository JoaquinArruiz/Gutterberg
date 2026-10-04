import { useDocumentStore } from "../../stores/document-store";
import { useRegionImage } from "../../lib/use-region-image";
import { cardRects, type GridSpec } from "../../lib/grid";
import { handlePoint, type Handle } from "../../lib/selection";
import type { NormalizedRect, Rect, Size } from "../../lib/coordinates";
import type { PageSize } from "../../lib/tauri";

/** Magnification of the loupe. While it is open, handle drags are slowed by the same factor. */
export const MAG = 4;
export const LOUPE = 168; // CSS px
const MARGIN = 16;
// Crop reach around the handle, in screen px. The loupe only shows LOUPE/MAG/2 = 21 px each way
// and fine drags move the handle at 1/MAG speed, so this leaves ample slack while keeping the
// crop small (≈160 px × MAG ≈ 640 px square) and quick to render and encode.
const REACH_PX = 80;
// Scale cap for the crop request (the crop itself stays ~640 px; this only bounds the page-scale maths).
const MAX_FULL_WIDTH_PX = 32768;

/**
 * The rectangle's four edges as SVG path segments, clipped to the loupe window so only
 * the visible parts are ever drawn (a dashed rect thousands of px wide is needlessly costly).
 */
function edgesPath(r: NormalizedRect, toLoupe: (x: number, y: number) => { x: number; y: number }) {
  const a = toLoupe(r.x, r.y);
  const b = toLoupe(r.x + r.width, r.y + r.height);
  const c = (v: number) => Math.min(Math.max(v, 0), LOUPE);
  const seg = (x1: number, y1: number, x2: number, y2: number) =>
    `M${c(x1).toFixed(1)} ${c(y1).toFixed(1)}L${c(x2).toFixed(1)} ${c(y2).toFixed(1)}`;
  const inside = (v: number) => v >= 0 && v <= LOUPE;
  const overlapX = b.x >= 0 && a.x <= LOUPE;
  const overlapY = b.y >= 0 && a.y <= LOUPE;
  let d = "";
  if (overlapX && inside(a.y)) d += seg(a.x, a.y, b.x, a.y);
  if (overlapX && inside(b.y)) d += seg(a.x, b.y, b.x, b.y);
  if (overlapY && inside(a.x)) d += seg(a.x, a.y, a.x, b.y);
  if (overlapY && inside(b.x)) d += seg(b.x, a.y, b.x, b.y);
  return d;
}

/**
 * Zoomed view around the held handle. Rendered (invisibly) as soon as a handle
 * is pressed so the sharp raster is ready by the time the hold timer fires.
 * Pointer-transparent: it never steals the drag.
 */
export function Magnifier({
  handle, selection, grid, page, pageRect, box, active,
}: {
  handle: Handle;
  selection: NormalizedRect;
  grid: GridSpec;
  page: PageSize;
  pageRect: Rect;
  box: Size;
  active: boolean;
}) {
  const { path, currentPage } = useDocumentStore();
  const dpr = window.devicePixelRatio || 1;
  const W = pageRect.width * MAG;
  const H = pageRect.height * MAG;
  const f = handlePoint(selection, handle);
  // Only a small crop around the handle is rendered (at ×MAG), not the whole page.
  const img = useRegionImage({
    docKey: path, pageIndex: currentPage, focus: f, pageRect,
    reachPx: REACH_PX, fullWidthPx: Math.min(MAX_FULL_WIDTH_PX, Math.round(W * dpr)),
  });
  if (!active) return null;

  const hx = pageRect.x + f.x * pageRect.width;
  const hy = pageRect.y + f.y * pageRect.height;
  // Up-left of the handle by default; flip when that would leave the viewport.
  const left = hx - LOUPE - MARGIN < 0 ? hx + MARGIN : hx - LOUPE - MARGIN;
  const top = hy - LOUPE - MARGIN < 0 ? hy + MARGIN : hy - LOUPE - MARGIN;
  const pos = {
    left: Math.min(Math.max(left, 4), Math.max(4, box.width - LOUPE - 4)),
    top: Math.min(Math.max(top, 4), Math.max(4, box.height - LOUPE - 4)),
  };
  // Everything is drawn in loupe pixels (LOUPE x LOUPE). Never build page-sized boxes here:
  // at 16x zoom the page is ~12,700 px wide on screen, so at x4 a page-sized element or SVG
  // would be tens of thousands of px and freeze the UI on every pointer move.
  const toLoupe = (nx: number, ny: number) => ({
    x: LOUPE / 2 + (nx - f.x) * W,
    y: LOUPE / 2 + (ny - f.y) * H,
  });
  const cards = cardRects(selection, grid, page);

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-full bg-white shadow-xl shadow-black/60"
      style={{ ...pos, width: LOUPE, height: LOUPE, border: "2px solid var(--accent)" }}
    >
      {img && (
        <img
          src={img.url}
          draggable={false}
          style={{
            position: "absolute", maxWidth: "none",
            // The crop is only ~REACH_PX*2*MAG px across whatever the zoom.
            left: toLoupe(img.region.x, img.region.y).x, top: toLoupe(img.region.x, img.region.y).y,
            width: img.region.width * W, height: img.region.height * H,
          }}
        />
      )}
      <svg className="absolute inset-0" width={LOUPE} height={LOUPE}>
        <path d={cards.map((c) => edgesPath(c, toLoupe)).join("")} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.8} />
        <path d={edgesPath(selection, toLoupe)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      </svg>
      {/* Crosshair on the exact point being moved. */}
      <div className="absolute bg-red-500/80" style={{ left: LOUPE / 2 - 0.5, top: LOUPE / 2 - 10, width: 1, height: 20 }} />
      <div className="absolute bg-red-500/80" style={{ left: LOUPE / 2 - 10, top: LOUPE / 2 - 0.5, width: 20, height: 1 }} />
      <span className="absolute bottom-3 left-0 right-0 text-center text-[10px] font-semibold text-white [text-shadow:0_0_3px_#000]">
        ×{MAG}
      </span>
    </div>
  );
}
