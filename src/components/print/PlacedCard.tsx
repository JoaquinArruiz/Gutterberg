import type { SheetPlacement } from "../../lib/sheet-api";
import type { RenderKind } from "../../lib/tauri";
import { useCardImage } from "../../lib/use-card-image";
import { useDocumentStore } from "../../stores/document-store";

/**
 * One card on a sheet: the crop of its source area, turned and sized as the exporter will place
 * it, `k` screen px per point. The image is only for display; the exported file keeps the original
 * vector content. `kind` is the render priority: the large preview uses "page", thumbnails "thumbnail".
 */
export function PlacedCard({ p, k, kind = "page" }: { p: SheetPlacement; k: number; kind?: RenderKind }) {
  const path = useDocumentStore((s) => s.path);
  const page = useDocumentStore((s) => s.pages[p.card_id.page_index]);
  const d = p.destination;
  // The image is upright and keeps the source's own shape; a quarter turn swaps the box it fills.
  const quarter = p.turn === 90 || p.turn === 270;
  const [w, h] = quarter ? [d.height * k, d.width * k] : [d.width * k, d.height * k];
  const dpr = window.devicePixelRatio || 1;
  const url = useCardImage(path, p.card_id, p.source, page, w * dpr, kind);
  return (
    <div
      className="absolute overflow-hidden bg-white"
      style={{ left: d.x * k, top: d.y * k, width: d.width * k, height: d.height * k }}
    >
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            maxWidth: "none",
            width: w,
            height: h,
            left: (d.width * k - w) / 2,
            top: (d.height * k - h) / 2,
            transform: p.turn ? `rotate(${p.turn}deg)` : undefined,
          }}
        />
      )}
    </div>
  );
}
