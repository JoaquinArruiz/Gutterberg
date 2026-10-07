import { useMemo } from "react";
import { useLayoutStore } from "../stores/layout-store";
import { usePrintStore } from "../stores/print-store";
import { applyEdits } from "./card-edits";
import type { Card } from "./sheet-api";

/** The library's cards as they print: the engine's cards with the user's turn, scale and order applied. */
export function useLibraryCards(): Card[] {
  const cards = usePrintStore((s) => s.cards);
  const edits = useLayoutStore((s) => s.cardEdits);
  return useMemo(() => applyEdits(cards, edits), [cards, edits]);
}
