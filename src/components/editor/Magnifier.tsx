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
    reachPx: REACH_PX, fullWidthPx: Math.round(W * dpr),
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
  const ox = LOUPE / 2 - f.x * W;
  const oy = LOUPE / 2 - f.y * H;
  const toPx = (r: NormalizedRect) => ({ x: r.x * W, y: r.y * H, width: r.width * W, height: r.height * H });
  const sel = toPx(selection);

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-full bg-white shadow-xl shadow-black/60"
      style={{ ...pos, width: LOUPE, height: LOUPE, border: "2px solid var(--accent)" }}
    >
      <div className="absolute" style={{ left: ox, top: oy, width: W, height: H }}>
        {img && (
          <img
            src={img.url}
            draggable={false}
            style={{
              position: "absolute", maxWidth: "none",
              left: img.region.x * W, top: img.region.y * H,
              width: img.region.width * W, height: img.region.height * H,
            }}
          />
        )}
        <svg className="absolute inset-0" width={W} height={H}>
          {cardRects(selection, grid, page).map((c, i) => {
            const r = toPx(c);
            return (
              <rect key={i} {...r} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.8} />
            );
          })}
          <rect {...sel} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        </svg>
      </div>
      {/* Crosshair on the exact point being moved. */}
      <div className="absolute bg-red-500/80" style={{ left: LOUPE / 2 - 0.5, top: LOUPE / 2 - 10, width: 1, height: 20 }} />
      <div className="absolute bg-red-500/80" style={{ left: LOUPE / 2 - 10, top: LOUPE / 2 - 0.5, width: 20, height: 1 }} />
      <span className="absolute bottom-3 left-0 right-0 text-center text-[10px] font-semibold text-white [text-shadow:0_0_3px_#000]">
        ×{MAG}
      </span>
    </div>
  );
}
