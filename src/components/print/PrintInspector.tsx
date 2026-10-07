import { useShallow } from "zustand/react/shallow";
import { formatMeasurement } from "../../lib/measurement";
import { effectiveGrid, MAX_SHEET_GRID, plannerRequired, type SheetGridMode } from "../../lib/print-request";
import { ptToMm } from "../../lib/units";
import { useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { planOf, usePrintStore } from "../../stores/print-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { NumberField } from "../ui/NumberField";
import { Select } from "../ui/Select";
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
          <p>⚠ {P.sheetsError}</p>
          <p className="mt-1">Cards are never scaled. Change the page, spacing or margins, or auto-fit the page.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" className={smallBtn} onClick={() => setPageMode("fit")}>
              Auto-fit page
            </button>
            {pageMode !== "same" && pageMode !== "fit" && (
              <button
                type="button"
                className={smallBtn}
                onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}
              >
                Switch orientation
              </button>
            )}
          </div>
        </div>
      )}

      <SelectedCardsSection />

      <CollapsibleSection id="print.plan" title="Plan">
        <Radio
          name="plan-mode"
          value="all"
          current={P.mode}
          onSelect={P.setMode}
          label="All cards in order"
          hint="Every card once, as the source lays them out."
        />
        <Radio
          name="plan-mode"
          value="custom"
          current={P.mode}
          onSelect={P.setMode}
          label="Custom selection"
          hint="Only the cards you give copies, e.g. 4 × A, 2 × B, 3 × C."
        />
        {P.mode === "custom" && (
          <div>
            <button type="button" className={smallBtn} onClick={P.startFromAllCards}>
              Start from all cards (1 each)
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
            Auto-fill
            <span className="block text-[var(--muted)]">Repeat the cards until the last sheet is full.</span>
          </span>
        </label>
        <div className="mt-1 text-[var(--muted)]">Order of copies</div>
        <Radio
          name="plan-order"
          value="grouped"
          current={P.order}
          onSelect={P.setOrder}
          label="Grouped"
          hint="A A A A, B B, C C C"
          disabled={sourceLayout}
        />
        <Radio
          name="plan-order"
          value="interleaved"
          current={P.order}
          onSelect={P.setOrder}
          label="Interleaved"
          hint="A B C, A B C, A C, A"
          disabled={sourceLayout}
        />
        {sourceLayout && (
          <p className="text-[var(--muted)]">The order only matters when the sheet grid is not the source's.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="print.sheet" title="Sheet">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--muted)]">Grid</span>
          <Select<SheetGridMode>
            label="Sheet grid"
            value={grid}
            onChange={P.setSheetGrid}
            options={[
              { value: "same", label: "Same as source", disabled: !sameAvailable },
              { value: "auto", label: "Auto (as many as fit)" },
              { value: "custom", label: "Rows × columns" },
            ]}
          />
        </div>
        {!sameAvailable && P.sheetGrid === "same" && (
          <p className="text-[var(--muted)]">
            "Same as source" is for all cards in order, as the page has them: no auto-fill, and no freeform, turned,
            resized or reordered cards. Auto is used instead.
          </p>
        )}
        {grid === "custom" && (
          <>
            <NumberField label="Columns" value={P.columns} min={1} max={MAX_SHEET_GRID} onCommit={P.setColumns} />
            <NumberField label="Rows" value={P.rows} min={1} max={MAX_SHEET_GRID} onCommit={P.setRows} />
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
            Group cards by size
            <span className="block text-[var(--muted)]">
              Cards of different sizes get their own sheets. Off: one shared grid, slots as large as the largest card.
            </span>
          </span>
        </label>
        <div className="mt-1 text-[var(--muted)]">Spacing between cards</div>
        <OutputSpacingFields />
        {first && (
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Sheet</span>
            <span className="tabular-nums">
              {fmt(ptToMm(first.page.width_pt))} × {fmt(ptToMm(first.page.height_pt))}
            </span>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="print.page" title="Page" defaultOpen={false}>
        <OutputPageFields />
      </CollapsibleSection>
    </div>
  );
}
