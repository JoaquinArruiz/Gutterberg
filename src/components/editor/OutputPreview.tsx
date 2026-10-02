import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePageImage } from "../../lib/use-page-image";
import { pxPerPoint, type Rect, type ViewportState } from "../../lib/coordinates";

const MAX_RENDER_PX = 8192;

/**
 * The exported page: each card's source region of the page raster, clipped and
 * moved to its destination from the Rust layout. Mirrors what the exporter does
 * (translate + clip, no scaling), using the raster only for display.
 */
export function OutputPreview({ screen, viewport }: { screen: Rect; viewport: ViewportState }) {
  const { path, currentPage, pages } = useDocumentStore();
  const result = useLayoutStore((s) => s.result);
  const page = pages[currentPage];
  const dpr = window.devicePixelRatio || 1;
  const widthPx = Math.min(MAX_RENDER_PX, Math.max(16, Math.round(screen.width * dpr)));
  const url = usePageImage(path, currentPage, widthPx, 150);
  const k = pxPerPoint(viewport.zoom);

  return (
    <div
      className="absolute bg-white shadow-lg shadow-black/50"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: screen.height }}
    >
      {url && page && result?.placements.map((p) => (
        <div
          key={p.index}
          className="absolute overflow-hidden"
          style={{
            left: p.destination.x * k, top: p.destination.y * k,
            width: p.destination.width * k, height: p.destination.height * k,
          }}
        >
          <img
            src={url}
            draggable={false}
            style={{
              position: "absolute", maxWidth: "none",
              left: -p.source.x * k, top: -p.source.y * k,
              width: page.width_pt * k, height: page.height_pt * k,
            }}
          />
        </div>
      ))}
    </div>
  );
}
