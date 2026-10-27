import { cropWidthPx } from "../../lib/card";
import type { SheetPlacement } from "../../lib/sheet-api";
import type { RenderKind } from "../../lib/tauri";
import { useCardImage } from "../../lib/use-card-image";
import { documentById, useDocumentStore } from "../../stores/document-store";
import { CardImage } from "./CardImage";
import { usePiecePeek } from "./use-piece-peek";

/**
 * One card on a sheet: the crop of its source area, straightened, turned and sized as the exporter will
 * place it, `k` screen px per point. The image is only for display; the exported file keeps the original
 * vector content. `kind` is the render priority: the large preview uses "page", thumbnails "thumbnail". A right-click
 * shows it large (`usePiecePeek`).
 */
export function PlacedCard({
  p,
  k,
  kind = "page",
  fill = "white",
}: {
  p: SheetPlacement;
  k: number;
  kind?: RenderKind;
  /** What shows where the source page paints nothing: white paper, or the colour behind pieces. */
  fill?: string;
}) {
  const path = useDocumentStore((s) => documentById(s, p.card_id.document_id)?.path ?? null);
  const page = useDocumentStore((s) => documentById(s, p.card_id.document_id)?.pages[p.card_id.page_index]);
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
  const peek = usePiecePeek(() => ({
    card: p.card_id,
    source: p.source,
    turn: p.turn,
    width: d.width,
    height: d.height,
  }));
  return (
    <div
      {...peek}
      data-testid="placed-card"
      className="absolute overflow-hidden"
      style={{ left: d.x * k, top: d.y * k, width: d.width * k, height: d.height * k, background: fill }}
    >
      {url && <CardImage url={url} source={p.source} turn={p.turn} aspect={d.width / d.height} />}
    </div>
  );
}
