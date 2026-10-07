import { useShallow } from "zustand/react/shallow";
import { cardSizePt, sanitizeCard, withAngle } from "../../lib/freeform";
import { formatMeasurement } from "../../lib/measurement";
import { mmToPt, ptToMm } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { MeasurementInput } from "../ui/MeasurementInput";
import { NumberField } from "../ui/NumberField";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

/**
 * The cards of the viewed page that are drawn one by one: how many there are, and for the picked one
 * its angle and size. The card tool draws them; this is where they are fine-tuned by number.
 */
export function FreeformSection() {
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const tool = useEditorStore((s) => s.tool);
  const selected = useEditorStore((s) => s.selectedCard);
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
  const edit = (patch: (c: NonNullable<typeof card>) => NonNullable<typeof card>) =>
    card && index !== null && update(currentPage, index, sanitizeCard(patch(card), page));

  return (
    <CollapsibleSection id="cards.freeform" title="Freeform cards">
      <p className="text-[var(--muted)]">
        {count === 0 ? "No freeform cards on this page." : `${count} card${count === 1 ? "" : "s"} on this page.`} They
        are printed from the Print stage.
      </p>
      {tool !== "card" && count > 0 && (
        <p className="text-[var(--muted)]">Choose the Card tool (C) to move, resize or rotate them.</p>
      )}
      {tool === "card" && !card && (
        <p className="text-[var(--muted)]">
          Drag on the page to draw a card, and click one to edit it. Drag the dot above a card to rotate it; Shift snaps
          to 15°.
        </p>
      )}
      {card && size && index !== null && (
        <>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Card</span>
            <span className="tabular-nums">
              {index + 1} · {formatMeasurement(ptToMm(size.width), unit, 1)} ×{" "}
              {formatMeasurement(ptToMm(size.height), unit, 1)}
            </span>
          </div>
          <NumberField
            label="Angle"
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
            label="Width"
            precise
            min={1}
            value={ptToMm(size.width)}
            onChange={(mm) => edit((c) => ({ ...c, width: mmToPt(mm) / page.width_pt }))}
          />
          <MeasurementInput
            label="Height"
            precise
            min={1}
            value={ptToMm(size.height)}
            onChange={(mm) => edit((c) => ({ ...c, height: mmToPt(mm) / page.height_pt }))}
          />
          <div>
            <button
              type="button"
              className={smallBtn}
              onClick={() => {
                remove(currentPage, index);
                setSelected(null);
              }}
            >
              Delete card
            </button>
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
