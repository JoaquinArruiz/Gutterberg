import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLayoutStore } from "../stores/layout-store";
import { planOf, usePrintStore } from "../stores/print-store";
import { useUiStore } from "../stores/ui-store";
import { pagesById, useLayoutDocuments } from "./documents";
import { buildPrintRequest, toRustDocuments } from "./print-request";
import { computeCards, computeSheets } from "./sheet-api";

/**
 * Keeps the Print stage's cards and sheets in step with the page groups of every PDF, the output
 * settings and the plan. Both come from the Rust engine; this only asks. Idle while the Cards stage is shown.
 */
export function usePrintSync() {
  const active = useUiStore((s) => s.stage === "print");
  const documents = useLayoutDocuments();
  const edits = useLayoutStore((s) => s.cardEdits);
  const output = useLayoutStore(
    useShallow((s) => ({
      gapXMm: s.gapXMm,
      gapYMm: s.gapYMm,
      gapLinked: s.gapLinked,
      pageMode: s.pageMode,
      orientation: s.orientation,
      customWidthMm: s.customWidthMm,
      customHeightMm: s.customHeightMm,
      margins: s.margins,
    })),
  );
  const plan = usePrintStore(useShallow(planOf));
  const cards = usePrintStore((s) => s.cards);

  // Entering the Print stage starts a fresh plan, so the preview never shows sheets from before the edits.
  useEffect(() => {
    if (active) usePrintStore.getState().beginPlanning();
  }, [active]);

  // The card library: every card of the groups. Independent of the plan and of output settings.
  useEffect(() => {
    if (!active || documents.length === 0) return;
    const { setCards } = usePrintStore.getState();
    let stale = false;
    const t = setTimeout(() => {
      computeCards(toRustDocuments(documents, useLayoutStore.getState()))
        .then((c) => !stale && setCards(c, null))
        .catch((e) => !stale && setCards([], e));
    }, 30);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [active, documents]);

  // The sheets the plan produces.
  useEffect(() => {
    if (!active || documents.length === 0) return;
    const { setSheets } = usePrintStore.getState();
    let stale = false;
    const t = setTimeout(() => {
      computeSheets(pagesById(documents), buildPrintRequest(plan, cards, documents, output, edits))
        .then((s) => !stale && setSheets(s, null))
        .catch((e) => !stale && setSheets(null, e));
    }, 30);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [active, documents, edits, output, plan, cards]);
}
