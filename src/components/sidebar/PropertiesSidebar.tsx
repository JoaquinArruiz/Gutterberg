import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { MAX_GAP_MM, useLayoutStore } from "../../stores/layout-store";
import { cardSizeMm, MAX_GRID, selectionAtMm, selectionForCardSize } from "../../lib/grid";
import { ptToMm } from "../../lib/units";
import { NumberField } from "../ui/NumberField";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-5">
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </section>
);

export function PropertiesSidebar() {
  const { pages, currentPage } = useDocumentStore();
  const { selection, setSelection } = useEditorStore();
  const { rows, columns, gapMm, setRows, setColumns, setGapMm, layoutError } = useLayoutStore();
  const page = pages[currentPage];

  if (!page) {
    return (
      <aside className="h-full bg-[var(--panel)] p-3">
        <p className="text-[var(--muted)]">No document open.</p>
      </aside>
    );
  }

  const grid = { rows, columns };
  const card = selection ? cardSizeMm(selection, page, grid) : null;
  const pw = ptToMm(page.width_pt);
  const ph = ptToMm(page.height_pt);

  return (
    <aside className="h-full overflow-y-auto bg-[var(--panel)] p-3">
      <Section title="Page">
        <div className="flex justify-between">
          <span className="text-[var(--muted)]">Size</span>
          <span className="tabular-nums">{pw.toFixed(1)} × {ph.toFixed(1)} mm</span>
        </div>
      </Section>

      <Section title="Layout">
        <NumberField label="Columns" value={columns} onCommit={setColumns} min={1} max={MAX_GRID} />
        <NumberField label="Rows" value={rows} onCommit={setRows} min={1} max={MAX_GRID} />
        <NumberField
          label="Card width"
          suffix="mm"
          decimals={2}
          step={0.1}
          min={1}
          value={card ? card.width : null}
          disabled={!selection}
          onCommit={(w) => selection && setSelection(selectionForCardSize(selection, page, grid, { width: w }))}
        />
        <NumberField
          label="Card height"
          suffix="mm"
          decimals={2}
          step={0.1}
          min={1}
          value={card ? card.height : null}
          disabled={!selection}
          onCommit={(h) => selection && setSelection(selectionForCardSize(selection, page, grid, { height: h }))}
        />
        {!selection && (
          <p className="text-[var(--muted)]">Drag on the page to select the region the cards occupy.</p>
        )}
      </Section>

      <Section title="Spacing">
        <NumberField label="Gap" suffix="mm" decimals={2} step={0.5} min={0} max={MAX_GAP_MM} value={gapMm} onCommit={setGapMm} />
        {layoutError && <p className="text-red-400">{layoutError}</p>}
      </Section>

      {selection && (
        <Section title="Selection position">
          <NumberField
            label="X" suffix="mm" decimals={2} step={0.1} value={selection.x * pw}
            onCommit={(x) => setSelection(selectionAtMm(selection, page, { x }))}
          />
          <NumberField
            label="Y" suffix="mm" decimals={2} step={0.1} value={selection.y * ph}
            onCommit={(y) => setSelection(selectionAtMm(selection, page, { y }))}
          />
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Total</span>
            <span className="tabular-nums">{(selection.width * pw).toFixed(1)} × {(selection.height * ph).toFixed(1)} mm</span>
          </div>
        </Section>
      )}
    </aside>
  );
}
