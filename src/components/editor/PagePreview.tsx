import type { Rect, Size } from "../../lib/coordinates";
import { usePageImage } from "../../lib/use-page-image";
import { useViewportImage } from "../../lib/use-viewport-image";
import { BASE_MAX_PX, needsDetail } from "../../lib/view-region";
import { useDocumentStore } from "../../stores/document-store";

/**
 * Raster preview positioned at `screen` (the page's rect inside the viewport),
 * in two layers:
 *  - base: the whole page, never wider than BASE_MAX_PX, so its cost is bounded at any zoom;
 *  - detail: once zoomed past that, a sharp crop of just what is on screen.
 * The base shows (blurry) until the detail crop lands, so there is no blank frame.
 */
export function PagePreview({ screen, box }: { screen: Rect; box: Size }) {
  const path = useDocumentStore((s) => s.path);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const dpr = window.devicePixelRatio || 1;
  const baseWidth = Math.min(BASE_MAX_PX, Math.max(16, Math.round(screen.width * dpr)));
  const base = usePageImage(path, currentPage, baseWidth, 150);
  const detail = useViewportImage({
    docKey: path,
    pageIndex: currentPage,
    pageRect: screen,
    box,
    dpr,
    enabled: needsDetail(screen, dpr),
  });
  return (
    <div
      className="absolute bg-white shadow-lg shadow-black/50"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: screen.height }}
    >
      {base && <img src={base} alt="" draggable={false} style={{ width: "100%", height: "100%" }} />}
      {detail && (
        <img
          data-detail
          src={detail.url}
          alt=""
          draggable={false}
          // Percentages of the page box, so the crop tracks the page exactly while a newer one is pending.
          style={{
            position: "absolute",
            maxWidth: "none",
            left: `${detail.region.x * 100}%`,
            top: `${detail.region.y * 100}%`,
            width: `${detail.region.width * 100}%`,
            height: `${detail.region.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}
