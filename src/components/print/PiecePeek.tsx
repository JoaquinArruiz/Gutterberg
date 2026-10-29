import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cropWidthPx, documentLetter, pieceReference } from "../../lib/card";
import { useCardImage } from "../../lib/use-card-image";
import { useWindowSize } from "../../lib/use-window-size";
import { documentById, useDocumentStore } from "../../stores/document-store";
import { useSeveralGrids } from "../../stores/layout-store";
import { type PiecePeek as Peek, useUiStore } from "../../stores/ui-store";
import { CardImage } from "./CardImage";

/** The share of the window the piece may take, leaving room around it and for its name below. */
const MAX_WIDTH = 0.9;
const MAX_HEIGHT = 0.82;

/**
 * The piece a right-click on it asked for (`usePiecePeek`), as large as the window allows: straightened, turned and
 * shaped as it prints, rendered at that size rather than stretched from a thumbnail, with its name under it. Display
 * only, like every picture of a piece. Any click or `Esc` closes it.
 */
export function PiecePeek() {
  const peek = useUiStore((s) => s.peek);
  return peek ? <PeekView peek={peek} /> : null;
}

function PeekView({ peek }: { peek: Peek }) {
  const { t } = useTranslation();
  const setPeek = useUiStore((s) => s.setPeek);
  const size = useWindowSize();
  const { card } = peek;
  const path = useDocumentStore((s) => documentById(s, card.document_id)?.path ?? null);
  const page = useDocumentStore((s) => documentById(s, card.document_id)?.pages[card.page_index]);
  const letter = useDocumentStore((s) =>
    documentLetter(
      s.documents.map((d) => d.id),
      card.document_id,
    ),
  );
  const several = useSeveralGrids()(card.document_id, card.page_index);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPeek(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setPeek]);

  const k = Math.min((size.width * MAX_WIDTH) / peek.width, (size.height * MAX_HEIGHT) / peek.height);
  const [boxW, boxH] = [peek.width * k, peek.height * k];
  const dpr = window.devicePixelRatio || 1;
  const url = useCardImage(
    path,
    card,
    peek.source,
    page,
    cropWidthPx(peek.source, peek.turn, boxW, boxH) * dpr,
    "page",
  );
  const name = pieceReference(card, letter, false, several);
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("library.peek", { name })}
      data-testid="piece-peek"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80"
      onPointerDown={() => setPeek(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative bg-white shadow-2xl shadow-black/60" style={{ width: boxW, height: boxH }}>
        {url && <CardImage url={url} source={peek.source} turn={peek.turn} aspect={boxW / boxH} />}
      </div>
      <p className="text-sm text-white">{name}</p>
    </div>
  );
}
