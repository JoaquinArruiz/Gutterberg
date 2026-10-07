import type { Rect } from "../../lib/coordinates";
import type { LayoutResult } from "../../lib/layout-api";
import { usePageImage } from "../../lib/use-page-image";
import { useDocumentStore } from "../../stores/document-store";

const MAX_RENDER_PX = 8192;
const EPS_PT = 0.01;

/**
 * The exported page: each card's source region of the page raster, clipped and
 * moved to its destination from the Rust layout. Mirrors what the exporter does
 * (translate + clip, no scaling), using the raster only for display.
 *
 * `screen` is the OUTPUT page's rect and `k` the screen px per point. The raster
 * is requested at the source page's on-screen size, so it depends on zoom only
 * (never on gaps, margins or page size): changing spacing just repositions crops.
 */
export function OutputPreview({ screen, k, result }: { screen: Rect; k: number; result: LayoutResult | null }) {
  const path = useDocumentStore((s) => s.path);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const pages = useDocumentStore((s) => s.pages);
  const page = pages[currentPage];
  const dpr = window.devicePixelRatio || 1;
  const widthPx = page ? Math.min(MAX_RENDER_PX, Math.max(16, Math.round(page.width_pt * k * dpr))) : 0;
  const url = usePageImage(path, currentPage, widthPx, 150);
  const out = result?.output_page;

  return (
    <div
      className="absolute bg-white shadow-lg shadow-black/50"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: screen.height }}
    >
      {url &&
        page &&
        result?.placements.map((p) => {
          const d = p.destination;
          const outside =
            !!out &&
            (d.x < -EPS_PT ||
              d.y < -EPS_PT ||
              d.x + d.width > out.width_pt + EPS_PT ||
              d.y + d.height > out.height_pt + EPS_PT);
          return (
            <div
              key={p.index}
              className="absolute overflow-hidden"
              style={{
                left: d.x * k,
                top: d.y * k,
                width: d.width * k,
                height: d.height * k,
                ...(outside && { opacity: 0.55, outline: "2px solid #f87171", outlineOffset: -1 }),
              }}
            >
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  maxWidth: "none",
                  left: -p.source.x * k,
                  top: -p.source.y * k,
                  width: page.width_pt * k,
                  height: page.height_pt * k,
                }}
              />
            </div>
          );
        })}
    </div>
  );
}
