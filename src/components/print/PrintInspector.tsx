import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { formatError } from "../../lib/errors";
import { formatMeasurement } from "../../lib/measurement";
import {
  type CardOrder,
  effectiveGrid,
  MAX_SHEET_GRID,
  type PlanMode,
  plannerRequired,
  type SheetGridMode,
} from "../../lib/print-request";
import { ptToMm } from "../../lib/units";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { planOf, usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { InfoTip } from "../ui/InfoTip";
import { NumberField } from "../ui/NumberField";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { BleedSection, DuplexSection, MarksSection } from "./FinishSections";
import { OutputPageFields, OutputSpacingFields } from "./OutputFields";
import { SelectedCardsSection } from "./SelectedCardsSection";

/** What to print and how the sheets look. Sections fold, and which are open is remembered. */
export function PrintInspector() {
  const { t } = useTranslation();
  const P = usePrintStore(
    useShallow((s) => ({
      ...planOf(s),
      sheets: s.sheets,
      sheetsError: s.sheetsError,
      setMode: s.setMode,
      setAutoFill: s.setAutoFill,
      setOrder: s.setOrder,
      setGroupBySize: s.setGroupBySize,
      setSheetGrid: s.setSheetGrid,
      setRows: s.setRows,
      setColumns: s.setColumns,
      startFromAllCards: s.startFromAllCards,
    })),
  );
  const { pageMode, orientation, setPageMode, setOrientation } = useLayoutStore(
    useShallow((s) => ({
      pageMode: s.pageMode,
      orientation: s.orientation,
      setPageMode: s.setPageMode,
      setOrientation: s.setOrientation,
    })),
  );
  const rawCards = usePrintStore((s) => s.cards);
  const edits = useLayoutStore((s) => s.cardEdits);
  const unit = useUnit();
  const fmt = (mm: number) => formatMeasurement(mm, unit);

  // Freeform, turned, resized or reordered cards need the card planner, which "same as source" is not.
  const planner = plannerRequired(rawCards, edits);
  const grid = effectiveGrid(P, planner);
  // "Same as source" is the default plan only: one sheet per source page with its own grid.
  const sameAvailable = P.mode === "all" && !P.autoFill && !planner;
  const sourceLayout = grid === "same";
  const first = P.sheets?.[0];

  return (
    <div className="h-full overflow-y-auto p-3" data-testid="print-inspector" data-hint-target="sheet-inspector">
      {P.sheetsError && (
        <div className="mb-3 rounded border border-red-400/50 bg-red-400/10 p-2 text-red-300" role="alert">
          <p>⚠ {formatError(P.sheetsError)}</p>
          <p className="mt-1">{t("print.error.note")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button onClick={() => setPageMode("fit")}>{t("print.error.autoFit")}</Button>
            {pageMode !== "same" && pageMode !== "fit" && (
              <Button onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}>
                {t("print.error.switchOrientation")}
              </Button>
            )}
          </div>
        </div>
      )}

      <SelectedCardsSection />

      <CollapsibleSection
        id="print.plan"
        title={t("print.sections.plan")}
        info={
          <>
            <span className="block">
              {t("print.plan.all")}: {t("print.plan.allHint")}
            </span>
            <span className="block">
              {t("print.plan.custom")}: {t("print.plan.customHint")}
            </span>
          </>
        }
      >
        <Segmented<PlanMode>
          fill
          label={t("print.sections.plan")}
          value={P.mode}
          onChange={P.setMode}
          options={[
            { value: "all", label: t("print.plan.all") },
            { value: "custom", label: t("print.plan.custom") },
          ]}
        />
        {P.mode === "custom" && (
          <div>
            <Button onClick={P.startFromAllCards}>{t("print.plan.startFromAll")}</Button>
          </div>
        )}
        <Switch
          checked={P.autoFill}
          onChange={P.setAutoFill}
          label={t("print.plan.autoFill")}
          info={t("print.plan.autoFillHint")}
        />
        <div className="mt-1 flex items-center gap-1 text-[var(--muted)]">
          {t("print.plan.order")}
          <InfoTip
            text={
              <>
                <span className="block">
                  {t("print.plan.grouped")}: {t("print.plan.groupedHint")}
                </span>
                <span className="block">
                  {t("print.plan.interleaved")}: {t("print.plan.interleavedHint")}
                </span>
              </>
            }
          />
        </div>
        <Segmented<CardOrder>
          fill
          label={t("print.plan.order")}
          value={P.order}
          onChange={P.setOrder}
          disabled={sourceLayout}
          options={[
            { value: "grouped", label: t("print.plan.grouped") },
            { value: "interleaved", label: t("print.plan.interleaved") },
          ]}
        />
        {sourceLayout && <p className="text-[var(--muted)]">{t("print.plan.orderNote")}</p>}
      </CollapsibleSection>

      <CollapsibleSection id="print.sheet" title={t("print.sections.sheet")}>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[var(--muted)]">{t("print.sheet.grid")}</span>
          <Select<SheetGridMode>
            label={t("print.sheet.gridLabel")}
            value={grid}
            onChange={P.setSheetGrid}
            options={[
              { value: "same", label: t("print.sheet.gridSame"), disabled: !sameAvailable },
              { value: "auto", label: t("print.sheet.gridAuto") },
              { value: "custom", label: t("print.sheet.gridCustom") },
            ]}
          />
        </div>
        {!sameAvailable && P.sheetGrid === "same" && <p className="text-[var(--muted)]">{t("print.sheet.sameNote")}</p>}
        {grid === "custom" && (
          <>
            <NumberField
              label={t("common.columns")}
              value={P.columns}
              min={1}
              max={MAX_SHEET_GRID}
              onCommit={P.setColumns}
            />
            <NumberField label={t("common.rows")} value={P.rows} min={1} max={MAX_SHEET_GRID} onCommit={P.setRows} />
          </>
        )}
        <Switch
          checked={P.groupBySize}
          disabled={sourceLayout}
          onChange={P.setGroupBySize}
          label={t("print.sheet.groupBySize")}
          info={t("print.sheet.groupBySizeHint")}
        />
        <div className="mt-1 flex items-center gap-1 text-[var(--muted)]">
          {t("print.sheet.outputGap")}
          <InfoTip text={t("print.sheet.outputGapNote")} />
        </div>
        <OutputSpacingFields />
        {first && (
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">{t("print.sheet.size")}</span>
            <span className="tabular-nums">
              {fmt(ptToMm(first.page.width_pt))} × {fmt(ptToMm(first.page.height_pt))}
            </span>
          </div>
        )}
      </CollapsibleSection>

      <MarksSection />
      <BleedSection />
      <DuplexSection />

      <CollapsibleSection id="print.page" title={t("print.sections.page")} defaultOpen={false}>
        <OutputPageFields />
      </CollapsibleSection>
    </div>
  );
}
