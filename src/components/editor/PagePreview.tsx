import { useDocumentStore } from "../../stores/document-store";
import { usePageImage } from "../../lib/use-page-image";
import type { Rect } from "../../lib/coordinates";

const MAX_RENDER_PX = 8192;

/** Raster preview positioned at `screen` (the page's rect inside the viewport). */
export function PagePreview({ screen }: { screen: Rect }) {
  const { path, currentPage } = useDocumentStore();
  const dpr = window.devicePixelRatio || 1;
  // Re-rendered (debounced) at the on-screen resolution; the previous image
  // stays visible, scaled, until the sharper one arrives.
  const widthPx = Math.min(MAX_RENDER_PX, Math.max(16, Math.round(screen.width * dpr)));
  const url = usePageImage(path, currentPage, widthPx, 150);
  return (
    <div
      className="absolute bg-white shadow-lg shadow-black/50"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: screen.height }}
    >
      {url && <img src={url} draggable={false} style={{ width: "100%", height: "100%" }} />}
    </div>
  );
}
