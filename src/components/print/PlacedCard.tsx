import { cropWidthPx } from "../../lib/card";
import type { SheetPlacement } from "../../lib/sheet-api";
import type { RenderKind } from "../../lib/tauri";
import { useCardImage } from "../../lib/use-card-image";
import { useDocumentStore } from "../../stores/document-store";
import { CardImage } from "./CardImage";

/**
 * One card on a sheet: the crop of its source area, straightened, turned and sized as the exporter will
 * place it, `k` screen px per point. The image is only for display; the exported file keeps the original
 * vector content. `kind` is the render priority: the large preview uses "page", thumbnails "thumbnail".
 */
export function PlacedCard({ p, k, kind = "page" }: { p: SheetPlacement; k: number; kind?: RenderKind }) {
  const path = useDocumentStore((s) => s.path);
  const page = useDocumentStore((s) => s.pages[p.card_id.page_index]);
  const d = p.destination;
  const dpr = window.devicePixelRatio || 1;
  const url = useCardImage(
    path,
    p.card_id,
    p.source,
    page,
    cropWidthPx(p.source, p.turn, d.width * k, d.height * k) * dpr,
    kind,
  );
  return (
    <div
      className="absolute overflow-hidden bg-white"
      style={{ left: d.x * k, top: d.y * k, width: d.width * k, height: d.height * k }}
    >
      {url && <CardImage url={url} source={p.source} turn={p.turn} />}
    </div>
  );
}
