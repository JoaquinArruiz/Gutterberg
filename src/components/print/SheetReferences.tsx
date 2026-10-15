import { useTranslation } from "react-i18next";
import { cardIdKey, documentLetter, pieceReference } from "../../lib/card";
import type { OutputSheet } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useSeveralGrids } from "../../stores/layout-store";
import { usePrintStore } from "../../stores/print-store";

const MIN_FONT = 7;
const MAX_FONT = 13;
const PAD_X = 3;
const PAD_Y = 1;
/** Rough width of a character as a share of the font size; enough to know whether a text fits. */
const CHAR_WIDTH = 0.6;

const widthOf = (text: string, font: number) => text.length * font * CHAR_WIDTH + PAD_X * 2;

/**
 * Each piece's reference at its top-left corner, in the words of the piece library, so a piece on the sheet can be
 * found in the library and on its source page. Only on screen (the exported file never has them), drawn above the
 * pieces and out of the pointer's way. A piece too small for the whole reference gets the shortest form, or none,
 * so the text never reaches the next piece. A back shows its own reference; the common back says so. `k` is screen
 * px per point.
 */
export function SheetReferences({ sheet, k }: { sheet: OutputSheet; k: number }) {
  const { t } = useTranslation();
  const documentIds = useDocumentStore((s) => s.documents.map((d) => d.id).join(","));
  const commonBack = usePrintStore((s) => s.finish.duplex.commonBack);
  const ids = documentIds === "" ? [] : documentIds.split(",").map(Number);
  const severalGrids = useSeveralGrids();
  const onBack = sheet.side === "back";
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="sheet-references" aria-hidden>
      {sheet.placements.map((p, i) => {
        const d = p.destination;
        const [w, h] = [d.width * k, d.height * k];
        const font = Math.max(MIN_FONT, Math.min(MAX_FONT, h * 0.12));
        const letter = documentLetter(ids, p.card_id.document_id);
        const common = onBack && commonBack === cardIdKey(p.card_id);
        const several = severalGrids(p.card_id.document_id, p.card_id.page_index);
        const whole = pieceReference(p.card_id, letter, false, several);
        const short = pieceReference(p.card_id, null, true, several);
        const candidates = common ? [`${whole} · ${t("library.thumb.commonBadge")}`, whole, short] : [whole, short];
        const text = candidates.find((c) => widthOf(c, font) <= w - 4 && font + PAD_Y * 2 <= h - 4);
        if (!text) return null;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a card can appear many times on a sheet; its slot is its identity
            key={i}
            data-testid="piece-reference"
            className="absolute whitespace-nowrap rounded-sm bg-black/75 leading-none text-white"
            style={{
              left: d.x * k + 2,
              top: d.y * k + 2,
              fontSize: font,
              padding: `${PAD_Y}px ${PAD_X}px`,
            }}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}
