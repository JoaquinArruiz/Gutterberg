import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { formatError } from "../../lib/errors";
import { formatMeasurement } from "../../lib/measurement";
import { effectiveGrid, MAX_SHEET_GRID, plannerRequired, type SheetGridMode } from "../../lib/print-request";
import { ptToMm } from "../../lib/units";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { planOf, usePrintStore } from "../../stores/print-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { NumberField } from "../ui/NumberField";
import { Select } from "../ui/Select";
import { BleedSection, DuplexSection, MarksSection } from "./FinishSections";
import { OutputPageFields, OutputSpacingFields } from "./OutputFields";
import { SelectedCardsSection } from "./SelectedCardsSection";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

function Radio<T extends string>({
  name,
  value,
  current,
  onSelect,
  label,
  hint,
  disabled,
}: {
  name: string;
  value: T;
  current: T;
  onSelect: (v: T) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 ${disabled ? "opacity-50" : ""}`}>
      <input
        type="radio"
        name={name}
        className="mt-0.5"
        checked={current === value}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span>
        {label}
        {hint && <span className="block text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  );
}

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
            <button type="button" className={smallBtn} onClick={() => setPageMode("fit")}>
              {t("print.error.autoFit")}
            </button>
            {pageMode !== "same" && pageMode !== "fit" && (
              <button
                type="button"
                className={smallBtn}
                onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}
              >
                {t("print.error.switchOrientation")}
              </button>
            )}
          </div>
        </div>
      )}

      <SelectedCardsSection />

      <CollapsibleSection id="print.plan" title={t("print.sections.plan")}>
        <Radio
          name="plan-mode"
          value="all"
          current={P.mode}
          onSelect={P.setMode}
          label={t("print.plan.all")}
          hint={t("print.plan.allHint")}
        />
        <Radio
          name="plan-mode"
          value="custom"
          current={P.mode}
          onSelect={P.setMode}
          label={t("print.plan.custom")}
          hint={t("print.plan.customHint")}
        />
        {P.mode === "custom" && (
          <div>
            <button type="button" className={smallBtn} onClick={P.startFromAllCards}>
              {t("print.plan.startFromAll")}
            </button>
          </div>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={P.autoFill}
            onChange={(e) => P.setAutoFill(e.target.checked)}
          />
          <span>
            {t("print.plan.autoFill")}
            <span className="block text-[var(--muted)]">{t("print.plan.autoFillHint")}</span>
          </span>
        </label>
        <div className="mt-1 text-[var(--muted)]">{t("print.plan.order")}</div>
        <Radio
          name="plan-order"
          value="grouped"
          current={P.order}
          onSelect={P.setOrder}
          label={t("print.plan.grouped")}
          hint={t("print.plan.groupedHint")}
          disabled={sourceLayout}
        />
        <Radio
          name="plan-order"
          value="interleaved"
          current={P.order}
          onSelect={P.setOrder}
          label={t("print.plan.interleaved")}
          hint={t("print.plan.interleavedHint")}
          disabled={sourceLayout}
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
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={P.groupBySize}
            disabled={sourceLayout}
            onChange={(e) => P.setGroupBySize(e.target.checked)}
          />
          <span>
            {t("print.sheet.groupBySize")}
            <span className="block text-[var(--muted)]">{t("print.sheet.groupBySizeHint")}</span>
          </span>
        </label>
        <div className="mt-1 text-[var(--muted)]">{t("print.sheet.outputGap")}</div>
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
