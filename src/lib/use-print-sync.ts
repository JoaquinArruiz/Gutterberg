import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDocumentStore } from "../stores/document-store";
import { useLayoutStore } from "../stores/layout-store";
import { planOf, usePrintStore } from "../stores/print-store";
import { useUiStore } from "../stores/ui-store";
import { buildPrintRequest, toRustGroups } from "./print-request";
import { computeCards, computeSheets } from "./sheet-api";

/**
 * Keeps the Print stage's cards and sheets in step with the page groups, the output settings and
 * the plan. Both come from the Rust engine; this only asks. Idle while the Cards stage is shown.
 */
export function usePrintSync() {
  const active = useUiStore((s) => s.stage === "print");
  const pages = useDocumentStore((s) => s.pages);
  const groups = useLayoutStore((s) => s.groups);
  const freeform = useLayoutStore((s) => s.freeform);
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
    if (!active || pages.length === 0) return;
    const { setCards } = usePrintStore.getState();
    let stale = false;
    const t = setTimeout(() => {
      computeCards(pages, toRustGroups(groups, pages, useLayoutStore.getState(), freeform))
        .then((c) => !stale && setCards(c, null))
        .catch((e) => !stale && setCards([], e));
    }, 30);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [active, pages, groups, freeform]);

  // The sheets the plan produces.
  useEffect(() => {
    if (!active || pages.length === 0) return;
    const { setSheets } = usePrintStore.getState();
    let stale = false;
    const t = setTimeout(() => {
      computeSheets(pages, buildPrintRequest(plan, cards, groups, pages, output, { freeform, edits }))
        .then((s) => !stale && setSheets(s, null))
        .catch((e) => !stale && setSheets(null, e));
    }, 30);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [active, pages, groups, freeform, edits, output, plan, cards]);
}
