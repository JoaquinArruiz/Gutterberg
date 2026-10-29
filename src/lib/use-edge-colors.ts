import { useEffect } from "react";
import { usePrintStore } from "../stores/print-store";
import { cardIdKey } from "./card";
import { edgeColors } from "./tauri";

/** How long the pieces must stay as they are before their edges are looked at again. */
const SETTLE_MS = 300;

/**
 * With the Edge bleed on, keeps `finish.bleed.edgeColors` the colour of every piece's edge, found from a small render
 * on this computer, so the sheets, the export and the saved project (which the command line exports) agree. It runs
 * again whenever the pieces change, since a piece drawn somewhere else has another edge.
 */
export function useEdgeColors(): void {
  const on = usePrintStore((s) => s.finish.bleed.source === "edge" && s.finish.bleed.mm > 0);
  const cards = usePrintStore((s) => s.cards);
  const setEdgeColors = usePrintStore((s) => s.setEdgeColors);
  useEffect(() => {
    if (!on || cards.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const pieces = cards.map((c) => ({ documentId: c.id.document_id, pageIndex: c.id.page_index, source: c.source }));
      edgeColors(pieces)
        .then((colors) => {
          if (!cancelled) setEdgeColors(Object.fromEntries(cards.map((c, i) => [cardIdKey(c.id), colors[i]])));
        })
        .catch(() => {});
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [on, cards, setEdgeColors]);
}
