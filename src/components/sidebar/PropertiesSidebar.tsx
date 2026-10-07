import { useShallow } from "zustand/react/shallow";
import type { NormalizedRect } from "../../lib/coordinates";
import { rangeLabel } from "../../lib/document-layout";
import { cardSizeMm, MAX_GRID, selectionAtMm, selectionForCardSize } from "../../lib/grid";
import { formatMeasurement } from "../../lib/measurement";
import { ptToMm } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { useCurrentGroup, useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { GapFields } from "../ui/GapFields";
import { MeasurementInput } from "../ui/MeasurementInput";
import { NumberField } from "../ui/NumberField";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

/** The Cards stage inspector: where the cards are on the viewed page. What to print is the Print stage's. */
export function PropertiesSidebar() {
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
        <p className="text-[var(--muted)]">No document open.</p>
      </div>
    );
  }

  const spec = grid && { rows: grid.rows, columns: grid.columns, gapXMm: grid.sourceGapXMm, gapYMm: grid.sourceGapYMm };
  const card = selection && spec ? cardSizeMm(selection, page, spec) : null;
  const pw = ptToMm(page.width_pt);
  const ph = ptToMm(page.height_pt);

  return (
    <div className="h-full overflow-y-auto p-3">
      <CollapsibleSection id="cards.page" title="Page">
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Size</span>
          <span className="tabular-nums">
            {fmt(pw)} × {fmt(ph)}
          </span>
        </div>
      </CollapsibleSection>

      {group?.kind === "skip" && (
        <CollapsibleSection id="cards.skipped" title="Skipped page">
          <p className="text-[var(--muted)]">
            {rangeLabel(group.pages)} {group.pages.first === group.pages.last ? "is" : "are"} left out of the export.
          </p>
          <div>
            <button type="button" className={smallBtn} onClick={() => L.setSkipped(currentPage, false)}>
              Include this page
            </button>
          </div>
        </CollapsibleSection>
      )}

      {group?.kind === "grid" && grid && spec && (
        <>
          <CollapsibleSection id="cards.layout" title="Source layout">
            <p className="text-[var(--muted)]">
              {rangeLabel(group.pages)}
              {group.pages.first === group.pages.last ? " has" : " share"} this grid.
            </p>
            <div className="flex flex-col gap-1.5" data-hint-target="grid-fields">
              <NumberField
                label="Columns"
                value={grid.columns}
                onCommit={(columns) => L.setGrid(currentPage, { columns })}
                min={1}
                max={MAX_GRID}
              />
              <NumberField
                label="Rows"
                value={grid.rows}
                onCommit={(rows) => L.setGrid(currentPage, { rows })}
                min={1}
                max={MAX_GRID}
              />
            </div>
            <MeasurementInput
              label="Card width"
              precise
              min={1}
              value={card ? card.width : null}
              disabled={!selection}
              onChange={(w) => selection && setSelection(selectionForCardSize(selection, page, spec, { width: w }))}
            />
            <MeasurementInput
              label="Card height"
              precise
              min={1}
              value={card ? card.height : null}
              disabled={!selection}
              onChange={(h) => selection && setSelection(selectionForCardSize(selection, page, spec, { height: h }))}
            />
            {!selection && (
              <p className="text-[var(--muted)]">Drag on the page to select the region the cards occupy.</p>
            )}
            <div>
              <button type="button" className={smallBtn} onClick={() => L.setSkipped(currentPage, true)}>
                Skip this page
              </button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="cards.spacing" title="Source spacing">
            <GapFields
              linked={grid.sourceGapLinked}
              onLink={(sourceGapLinked) => L.setGrid(currentPage, { sourceGapLinked })}
              x={grid.sourceGapXMm}
              y={grid.sourceGapYMm}
              onX={(sourceGapXMm) => L.setGrid(currentPage, { sourceGapXMm })}
              onY={(sourceGapYMm) => L.setGrid(currentPage, { sourceGapYMm })}
            />
            <p className="text-[var(--muted)]">Gap already between cards in the PDF.</p>
          </CollapsibleSection>
        </>
      )}

      <CollapsibleSection id="cards.output" title="Output">
        <p className="text-[var(--muted)]">
          Spacing between cards, page size and margins, and which cards go on which sheet, are set in the Print stage.
        </p>
        <div>
          <button type="button" className={smallBtn} onClick={() => setStage("print")}>
            Open Print stage
          </button>
        </div>
        {L.layoutError && <p className="text-red-400">{L.layoutError}</p>}
      </CollapsibleSection>

      {selection && (
        <CollapsibleSection id="cards.selection" title="Selection position">
          <MeasurementInput
            label="X"
            precise
            value={selection.x * pw}
            onChange={(x) => setSelection(selectionAtMm(selection, page, { x }))}
          />
          <MeasurementInput
            label="Y"
            precise
            value={selection.y * ph}
            onChange={(y) => setSelection(selectionAtMm(selection, page, { y }))}
          />
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Total</span>
            <span className="tabular-nums">
              {fmt(selection.width * pw)} × {fmt(selection.height * ph)}
            </span>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
