import { useMemo } from "react";
import { cardIdKey } from "../../lib/card";
import { formatCardSize, scaleCards, scaleForSize } from "../../lib/card-edits";
import { ptToMm } from "../../lib/units";
import { useLibraryCards } from "../../lib/use-library-cards";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { MeasurementInput } from "../ui/MeasurementInput";
import { NumberField } from "../ui/NumberField";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";
/** Cards whose source sizes differ by less than this (points) can be given one real size together. */
const SAME_SIZE_PT = 0.5;

/**
 * The size the selected cards print at. Cards keep their size unless it is set here: a real size in the
 * user's unit (e.g. 63 × 88 mm) or a percentage, stored as one scale per card and shown wherever the size
 * is shown, so a scale is never hidden.
 */
export function SelectedCardsSection() {
  const cards = useLibraryCards();
  const selected = usePrintStore((s) => s.selection.selected);
  const edits = useLayoutStore((s) => s.cardEdits);
  const setEdits = useLayoutStore((s) => s.setCardEdits);
  const unit = useUnit();
  const picked = useMemo(() => cards.filter((c) => selected.includes(cardIdKey(c.id))), [cards, selected]);
  const keys = picked.map((c) => cardIdKey(c.id));
  const first = picked[0];
  const scale = first && picked.every((c) => Math.abs(c.scale - first.scale) < 1e-6) ? first.scale : null;
  // A real size means the same thing for every card only when they are the same size to begin with.
  const sameSource =
    !!first &&
    picked.every(
      (c) =>
        Math.abs(c.source.width - first.source.width) < SAME_SIZE_PT &&
        Math.abs(c.source.height - first.source.height) < SAME_SIZE_PT,
    );
  const apply = (s: number) => setEdits(scaleCards(edits, keys, s));

  return (
    <CollapsibleSection id="print.cards" title="Selected cards">
      {!first ? (
        <p className="text-[var(--muted)]">Select cards in the library to turn them or set their real size.</p>
      ) : (
        <>
          <div className="flex justify-between gap-2" data-testid="card-size-summary">
            <span className="text-[var(--muted)]">
              {picked.length === 1 ? "Printed size" : `${picked.length} cards`}
            </span>
            <span className="tabular-nums">
              {picked.length === 1
                ? formatCardSize(first, unit)
                : scale === null
                  ? "different sizes"
                  : `${(scale * 100).toFixed(1)}%`}
            </span>
          </div>
          <MeasurementInput
            label="Width"
            precise
            min={1}
            disabled={!sameSource}
            value={sameSource && scale !== null ? ptToMm(first.source.width * scale) : null}
            onChange={(mm) => apply(scaleForSize(first.source, "width", mm))}
          />
          <MeasurementInput
            label="Height"
            precise
            min={1}
            disabled={!sameSource}
            value={sameSource && scale !== null ? ptToMm(first.source.height * scale) : null}
            onChange={(mm) => apply(scaleForSize(first.source, "height", mm))}
          />
          <NumberField
            label="Scale"
            value={scale === null ? null : scale * 100}
            decimals={1}
            min={10}
            max={500}
            step={1}
            fineStep={0.1}
            coarseStep={10}
            suffix="%"
            onCommit={(pct) => apply(pct / 100)}
          />
          <div>
            <button
              type="button"
              className={smallBtn}
              disabled={picked.every((c) => c.scale === 1)}
              onClick={() => apply(1)}
            >
              Back to the size on the page
            </button>
          </div>
          <p className="text-[var(--muted)]">
            {sameSource
              ? "Setting a width or height keeps the card's shape. 100% is the size on the page."
              : "These cards differ in size: set a percentage, or select cards of one size to give a real size."}
          </p>
        </>
      )}
    </CollapsibleSection>
  );
}
