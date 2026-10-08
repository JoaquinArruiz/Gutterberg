import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cardIdKey } from "../../lib/card";
import { formatCardSize, scaleCards, scaleForSize, setBacks } from "../../lib/card-edits";
import { formatDecimal } from "../../lib/measurement";
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
 * The size the selected pieces print at. Pieces keep their size unless it is set here: a real size in the
 * user's unit (e.g. 63 × 88 mm) or a percentage, stored as one scale per card and shown wherever the size
 * is shown, so a scale is never hidden.
 */
export function SelectedCardsSection() {
  const { t } = useTranslation();
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
  const picking = usePrintStore((s) => s.pickingBack);
  const setPicking = usePrintStore((s) => s.setPickingBack);
  const commonBack = usePrintStore((s) => s.finish.duplex.commonBack);
  // The back the selection shares: none, a piece, or "different" when they disagree.
  const backKeys = new Set(keys.map((k) => edits.backs[k] ?? null));
  const sharedBack = backKeys.size === 1 ? [...backKeys][0] : undefined;
  const backCard = sharedBack ? cards.find((c) => cardIdKey(c.id) === sharedBack) : undefined;
  const backText =
    sharedBack === undefined
      ? t("print.selected.backMixed")
      : backCard
        ? t("library.thumb.label", {
            page: backCard.id.page_index + 1,
            position:
              backCard.id.kind === "grid"
                ? t("library.thumb.gridPosition", { row: backCard.id.row + 1, column: backCard.id.column + 1 })
                : t("library.thumb.freeformPosition", { n: backCard.id.index + 1 }),
          })
        : commonBack
          ? t("print.selected.backCommon")
          : t("print.selected.backNone");

  return (
    <CollapsibleSection id="print.cards" title={t("print.selected.title")}>
      {!first ? (
        <p className="text-[var(--muted)]">{t("print.selected.empty")}</p>
      ) : (
        <>
          <div className="flex justify-between gap-2" data-testid="card-size-summary">
            <span className="text-[var(--muted)]">
              {picked.length === 1
                ? t("print.selected.printedSize")
                : t("print.selected.count", { count: picked.length })}
            </span>
            <span className="tabular-nums">
              {picked.length === 1
                ? formatCardSize(first, unit)
                : scale === null
                  ? t("print.selected.differentSizes")
                  : `${formatDecimal(scale * 100, 1)}%`}
            </span>
          </div>
          <MeasurementInput
            label={t("common.width")}
            precise
            min={1}
            disabled={!sameSource}
            value={sameSource && scale !== null ? ptToMm(first.source.width * scale) : null}
            onChange={(mm) => apply(scaleForSize(first.source, "width", mm))}
          />
          <MeasurementInput
            label={t("common.height")}
            precise
            min={1}
            disabled={!sameSource}
            value={sameSource && scale !== null ? ptToMm(first.source.height * scale) : null}
            onChange={(mm) => apply(scaleForSize(first.source, "height", mm))}
          />
          <NumberField
            label={t("print.selected.scale")}
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
              {t("print.selected.backToPage")}
            </button>
          </div>
          <div className="flex justify-between gap-2" data-testid="back-summary">
            <span className="text-[var(--muted)]">{t("print.selected.back")}</span>
            <span className="tabular-nums">{backText}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={smallBtn} aria-pressed={picking} onClick={() => setPicking(!picking)}>
              {t("print.selected.pickBack")}
            </button>
            <button
              type="button"
              className={smallBtn}
              disabled={keys.every((k) => edits.backs[k] === undefined)}
              onClick={() => setEdits(setBacks(edits, keys, null))}
            >
              {t("print.selected.clearBack")}
            </button>
          </div>
          <p className="text-[var(--muted)]">
            {sameSource ? t("print.selected.sameNote") : t("print.selected.differNote")}
          </p>
        </>
      )}
    </CollapsibleSection>
  );
}
