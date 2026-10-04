import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { MAX_GAP_MM, MAX_MARGIN_MM, useLayoutStore, type PageMode } from "../../stores/layout-store";
import { cardSizeMm, MAX_GRID, selectionAtMm, selectionForCardSize } from "../../lib/grid";
import { ptToMm } from "../../lib/units";
import { usePreviewResult } from "../../lib/view-page";
import { formatMeasurement } from "../../lib/measurement";
import { useUnit } from "../../stores/preferences-store";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Select } from "../ui/Select";
import { NumberField } from "../ui/NumberField";

function GapFields({
  linked, onLink, x, y, onX, onY,
}: {
  linked: boolean; onLink: (l: boolean) => void;
  x: number; y: number; onX: (v: number) => void; onY: (v: number) => void;
}) {
  const f = { min: 0, max: MAX_GAP_MM };
  return (
    <>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input type="checkbox" checked={linked} onChange={(e) => onLink(e.target.checked)} />
        Link horizontal / vertical
      </label>
      <MeasurementInput label={linked ? "Gap" : "Horizontal"} value={x} onChange={onX} {...f} />
      {!linked && <MeasurementInput label="Vertical" value={y} onChange={onY} {...f} />}
    </>
  );
}

const PAGE_MODES: { id: PageMode; label: string }[] = [
  { id: "same", label: "Same as source" },
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
  { id: "legal", label: "Legal" },
  { id: "custom", label: "Custom" },
  { id: "fit", label: "Auto-fit to cards" },
];

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-5">
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </section>
);

export function PropertiesSidebar() {
  const { pages, currentPage } = useDocumentStore();
  const { selection, setSelection } = useEditorStore();
  const L = useLayoutStore();
  const { rows, columns, setRows, setColumns, layoutError } = L;
  const page = pages[currentPage];
  const shown = usePreviewResult();
  const unit = useUnit();
  const fmt = (mm: number, decimals?: number) => formatMeasurement(mm, unit, decimals);

  if (!page) {
    return (
      <div className="h-full p-3">
        <p className="text-[var(--muted)]">No document open.</p>
      </div>
    );
  }

  const grid = { rows, columns, gapXMm: L.sourceGapXMm, gapYMm: L.sourceGapYMm };
  const card = selection ? cardSizeMm(selection, page, grid) : null;
  const pw = ptToMm(page.width_pt);
  const ph = ptToMm(page.height_pt);

  return (
    <div className="h-full overflow-y-auto p-3">
      <Section title="Page">
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Size</span>
          <span className="tabular-nums">{fmt(pw)} × {fmt(ph)}</span>
        </div>
      </Section>

      <Section title="Source layout">
        <NumberField label="Columns" value={columns} onCommit={setColumns} min={1} max={MAX_GRID} />
        <NumberField label="Rows" value={rows} onCommit={setRows} min={1} max={MAX_GRID} />
        <MeasurementInput
          label="Card width" precise min={1}
          value={card ? card.width : null}
          disabled={!selection}
          onChange={(w) => selection && setSelection(selectionForCardSize(selection, page, grid, { width: w }))}
        />
        <MeasurementInput
          label="Card height" precise min={1}
          value={card ? card.height : null}
          disabled={!selection}
          onChange={(h) => selection && setSelection(selectionForCardSize(selection, page, grid, { height: h }))}
        />
        {!selection && (
          <p className="text-[var(--muted)]">Drag on the page to select the region the cards occupy.</p>
        )}
      </Section>

      <Section title="Source spacing">
        <GapFields
          linked={L.sourceGapLinked} onLink={L.setSourceGapLinked}
          x={L.sourceGapXMm} y={L.sourceGapYMm} onX={L.setSourceGapX} onY={L.setSourceGapY}
        />
        <p className="text-[var(--muted)]">Gap already between cards in the PDF.</p>
      </Section>

      <Section title="Output spacing">
        <GapFields
          linked={L.gapLinked} onLink={L.setGapLinked}
          x={L.gapXMm} y={L.gapYMm} onX={L.setGapX} onY={L.setGapY}
        />
        <p className="text-[var(--muted)]">Final gap between cards. Independent of the source gap.</p>
      </Section>

      <Section title="Output page">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--muted)]">Size</span>
          <Select
            label="Page size" value={L.pageMode} onChange={L.setPageMode}
            options={PAGE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          />
        </div>
        {L.pageMode === "custom" && (
          <>
            <MeasurementInput label="Width" min={10} value={L.customWidthMm} onChange={(w) => L.setCustomSize(w, undefined)} />
            <MeasurementInput label="Height" min={10} value={L.customHeightMm} onChange={(h) => L.setCustomSize(undefined, h)} />
          </>
        )}
        {L.pageMode !== "same" && L.pageMode !== "fit" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--muted)]">Orientation</span>
            <Select
              label="Orientation" value={L.orientation} onChange={L.setOrientation}
              options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]}
            />
          </div>
        )}
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <MeasurementInput
            key={side} label={`Margin ${side}`} min={0} max={MAX_MARGIN_MM}
            value={L.margins[side]} onChange={(v) => L.setMargin(side, v)}
          />
        ))}
        {shown && (
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Result</span>
            <span className="tabular-nums">
              {fmt(ptToMm(shown.output_page.width_pt))} × {fmt(ptToMm(shown.output_page.height_pt))}
            </span>
          </div>
        )}
        {L.result?.overflow && (
          <div className="rounded border border-red-400/50 bg-red-400/10 p-2 text-red-300">
            <p>
              ⚠ Layout exceeds the page by {fmt(L.result.overflow.width_mm)} horizontally
              and {fmt(L.result.overflow.height_mm)} vertically. Cards are never scaled.
            </p>
            <p className="mt-1">Change the page size or orientation, reduce spacing or margins, or auto-fit the page. Export is disabled until it fits.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button className={smallBtn} onClick={() => L.setPageMode("fit")}>Auto-fit page</button>
              {L.pageMode !== "same" && L.pageMode !== "fit" && (
                <button className={smallBtn} onClick={() => L.setOrientation(L.orientation === "portrait" ? "landscape" : "portrait")}>
                  Switch orientation
                </button>
              )}
            </div>
          </div>
        )}
        {layoutError && <p className="text-red-400">{layoutError}</p>}
      </Section>

      {selection && (
        <Section title="Selection position">
          <MeasurementInput
            label="X" precise value={selection.x * pw}
            onChange={(x) => setSelection(selectionAtMm(selection, page, { x }))}
          />
          <MeasurementInput
            label="Y" precise value={selection.y * ph}
            onChange={(y) => setSelection(selectionAtMm(selection, page, { y }))}
          />
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Total</span>
            <span className="tabular-nums">{fmt(selection.width * pw)} × {fmt(selection.height * ph)}</span>
          </div>
        </Section>
      )}
    </div>
  );
}
