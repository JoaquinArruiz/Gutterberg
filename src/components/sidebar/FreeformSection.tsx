import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { OrientedRect } from "../../lib/card";
import { deletePicked } from "../../lib/editor-actions";
import { cardSizePt, sanitizeCard, withAngle } from "../../lib/freeform";
import { formatMeasurement } from "../../lib/measurement";
import { mmToPt, ptToMm } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { MeasurementInput } from "../ui/MeasurementInput";
import { NumberField } from "../ui/NumberField";

/** Whether every value is the same, to a hundredth. */
const same = (values: number[]) => values.every((v) => Math.abs(v - values[0]) < 0.01);

/**
 * The pieces of the viewed page that are drawn one by one: how many there are, and for the picked ones their
 * angle and size (a value typed goes to every picked piece; values that differ say so). The piece tool draws
 * them; this is where they are fine-tuned by number.
 */
export function FreeformSection() {
  const { t } = useTranslation();
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const tool = useEditorStore((s) => s.tool);
  const selected = useEditorStore((s) => s.selectedCard);
  const pickedCards = useEditorStore((s) => s.pickedCards);
  const setSelected = useEditorStore((s) => s.setSelectedCard);
  const { cards, update, remove } = useLayoutStore(
    useShallow((s) => ({
      cards: s.freeform[currentPage],
      update: s.updateFreeformCard,
      remove: s.deleteFreeformCard,
    })),
  );
  const unit = useUnit();
  const count = cards?.length ?? 0;
  if (!page || (count === 0 && tool !== "card")) return null;

  const index = selected?.page === currentPage ? selected.index : null;
  const card = index === null ? null : (cards?.[index] ?? null);
  const size = card ? cardSizePt(card, page) : null;
  // Every picked piece of this page (the one being edited last).
  const picked = (selected?.page === currentPage ? pickedCards : []).filter((i) => cards?.[i]);
  const many = picked.length > 1;
  const edit = (patch: (c: OrientedRect) => OrientedRect) => {
    for (const i of many ? picked : index === null ? [] : [index]) {
      const c = cards?.[i];
      if (c) update(currentPage, i, sanitizeCard(patch(c), page));
    }
  };
  const sizes = picked.map((i) => cardSizePt(cards?.[i] as OrientedRect, page));
  const label = (text: string, values: number[]) =>
    many && !same(values) ? t("freeform.mixed", { label: text }) : text;

  return (
    <CollapsibleSection id="cards.freeform" title={t("freeform.title")}>
      <p className="text-[var(--muted)]">{count === 0 ? t("freeform.none") : t("freeform.count", { count })}</p>
      {tool !== "card" && tool !== "pick" && count > 0 && (
        <p className="text-[var(--muted)]">{t("freeform.chooseTool")}</p>
      )}
      {tool === "card" && !card && <p className="text-[var(--muted)]">{t("freeform.drawHint")}</p>}
      {card && size && index !== null && (
        <>
          {many ? (
            <>
              <p>{t("freeform.picked", { count: picked.length })}</p>
              <p className="text-[var(--muted)]">{t("freeform.pickedNote")}</p>
            </>
          ) : (
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">{t("freeform.piece")}</span>
              <span className="tabular-nums">
                {index + 1} · {formatMeasurement(ptToMm(size.width), unit, 1)} ×{" "}
                {formatMeasurement(ptToMm(size.height), unit, 1)}
              </span>
            </div>
          )}
          <NumberField
            label={label(
              t("freeform.angle"),
              picked.map((i) => cards?.[i]?.angle_deg ?? 0),
            )}
            value={card.angle_deg}
            onCommit={(v) => edit((c) => withAngle(c, v))}
            decimals={1}
            min={-180}
            max={180}
            step={1}
            fineStep={0.1}
            coarseStep={15}
            suffix="°"
          />
          <MeasurementInput
            label={label(
              t("common.width"),
              sizes.map((z) => z.width),
            )}
            precise
            min={1}
            value={ptToMm(size.width)}
            onChange={(mm) => edit((c) => ({ ...c, width: mmToPt(mm) / page.width_pt }))}
          />
          <MeasurementInput
            label={label(
              t("common.height"),
              sizes.map((z) => z.height),
            )}
            precise
            min={1}
            value={ptToMm(size.height)}
            onChange={(mm) => edit((c) => ({ ...c, height: mmToPt(mm) / page.height_pt }))}
          />
          <div>
            <Button
              onClick={() => {
                if (many) deletePicked();
                else {
                  remove(currentPage, index);
                  setSelected(null);
                }
              }}
            >
              {many ? t("freeform.deleteMany", { count: picked.length }) : t("freeform.delete")}
            </Button>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
