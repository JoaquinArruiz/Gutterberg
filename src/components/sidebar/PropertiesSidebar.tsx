import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { NormalizedRect } from "../../lib/coordinates";
import { pageCount, rangeLabel } from "../../lib/document-layout";
import { formatError } from "../../lib/errors";
import { cardSizeMm, MAX_GRID, selectionAtMm, selectionForCardSize } from "../../lib/grid";
import { formatMeasurement } from "../../lib/measurement";
import { ptToMm } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { useCurrentGroup, useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { GapFields } from "../ui/GapFields";
import { MeasurementInput } from "../ui/MeasurementInput";
import { NumberField } from "../ui/NumberField";
import { AiSortSection } from "./AiSortSection";
import { DetectSection } from "./DetectSection";
import { FreeformSection } from "./FreeformSection";
import { PresetsSection } from "./PresetsSection";

/** The Source tab inspector: where the pieces are on the viewed page. What to print is the Print tab's. */
export function PropertiesSidebar() {
  const { t } = useTranslation();
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const group = useCurrentGroup();
  const L = useLayoutStore(
    useShallow((s) => ({
      layoutError: s.layoutError,
      setGrid: s.setGrid,
      setSelection: s.setSelection,
      setSkipped: s.setSkipped,
    })),
  );
  const setStage = useUiStore((s) => s.setStage);
  const grid = group?.kind === "grid" ? group.grid : null;
  const selection = group?.kind === "grid" ? group.selection : null;
  const setSelection = (r: NormalizedRect | null) => L.setSelection(currentPage, r);
  const unit = useUnit();
  const fmt = (mm: number, decimals?: number) => formatMeasurement(mm, unit, decimals);

  if (!page) {
    return (
      <div className="h-full p-3">
        <p className="text-[var(--muted)]">{t("source.noDocument")}</p>
      </div>
    );
  }

  const spec = grid && { rows: grid.rows, columns: grid.columns, gapXMm: grid.sourceGapXMm, gapYMm: grid.sourceGapYMm };
  const card = selection && spec ? cardSizeMm(selection, page, spec) : null;
  const pw = ptToMm(page.width_pt);
  const ph = ptToMm(page.height_pt);

  return (
    <div className="h-full overflow-y-auto p-3">
      <CollapsibleSection id="cards.page" title={t("source.sections.page")}>
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">{t("source.size")}</span>
          <span className="tabular-nums">
            {fmt(pw)} × {fmt(ph)}
          </span>
        </div>
      </CollapsibleSection>

      {group?.kind === "skip" && (
        <CollapsibleSection id="cards.skipped" title={t("source.sections.skipped")}>
          <p className="text-[var(--muted)]">
            {t("source.skippedRange", { range: rangeLabel(group.pages), count: pageCount(group.pages) })}
          </p>
          <div>
            <Button onClick={() => L.setSkipped(currentPage, false)}>{t("source.includePage")}</Button>
          </div>
        </CollapsibleSection>
      )}

      {group?.kind !== "skip" && <DetectSection />}

      <AiSortSection />

      {group?.kind === "grid" && grid && spec && (
        <>
          <CollapsibleSection id="cards.layout" title={t("source.sections.layout")}>
            <p className="text-[var(--muted)]">
              {t("source.sharedGrid", { range: rangeLabel(group.pages), count: pageCount(group.pages) })}
            </p>
            <div className="flex flex-col gap-1.5" data-hint-target="grid-fields">
              <NumberField
                label={t("common.columns")}
                value={grid.columns}
                onCommit={(columns) => L.setGrid(currentPage, { columns })}
                min={1}
                max={MAX_GRID}
              />
              <NumberField
                label={t("common.rows")}
                value={grid.rows}
                onCommit={(rows) => L.setGrid(currentPage, { rows })}
                min={1}
                max={MAX_GRID}
              />
            </div>
            <MeasurementInput
              label={t("source.pieceWidth")}
              precise
              min={1}
              value={card ? card.width : null}
              disabled={!selection}
              onChange={(w) => selection && setSelection(selectionForCardSize(selection, page, spec, { width: w }))}
            />
            <MeasurementInput
              label={t("source.pieceHeight")}
              precise
              min={1}
              value={card ? card.height : null}
              disabled={!selection}
              onChange={(h) => selection && setSelection(selectionForCardSize(selection, page, spec, { height: h }))}
            />
            {!selection && <p className="text-[var(--muted)]">{t("source.dragRegion")}</p>}
            <div>
              <Button onClick={() => L.setSkipped(currentPage, true)}>{t("source.skipPage")}</Button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="cards.spacing" title={t("source.sections.gap")} info={t("source.gapNote")}>
            <GapFields
              linked={grid.sourceGapLinked}
              onLink={(sourceGapLinked) => L.setGrid(currentPage, { sourceGapLinked })}
              x={grid.sourceGapXMm}
              y={grid.sourceGapYMm}
              onX={(sourceGapXMm) => L.setGrid(currentPage, { sourceGapXMm })}
              onY={(sourceGapYMm) => L.setGrid(currentPage, { sourceGapYMm })}
            />
          </CollapsibleSection>

          <PresetsSection grid={grid} page={currentPage} />
        </>
      )}

      {group?.kind !== "skip" && <FreeformSection />}

      <CollapsibleSection id="cards.output" title={t("source.sections.output")} info={t("source.outputNote")}>
        <div>
          <Button onClick={() => setStage("print")}>{t("source.openPrint")}</Button>
        </div>
        {L.layoutError && <p className="text-red-400">{formatError(L.layoutError)}</p>}
      </CollapsibleSection>

      {selection && (
        <CollapsibleSection id="cards.selection" title={t("source.sections.selection")}>
          <MeasurementInput
            label={t("common.x")}
            precise
            value={selection.x * pw}
            onChange={(x) => setSelection(selectionAtMm(selection, page, { x }))}
          />
          <MeasurementInput
            label={t("common.y")}
            precise
            value={selection.y * ph}
            onChange={(y) => setSelection(selectionAtMm(selection, page, { y }))}
          />
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">{t("source.total")}</span>
            <span className="tabular-nums">
              {fmt(selection.width * pw)} × {fmt(selection.height * ph)}
            </span>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
