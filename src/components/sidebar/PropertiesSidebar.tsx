import { useDocumentStore } from "../../stores/document-store";
import { ptToMm } from "../../lib/units";

export function PropertiesSidebar() {
  const { pages, currentPage } = useDocumentStore();
  const size = pages[currentPage];
  return (
    <aside className="h-full bg-[var(--panel)] p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Page</div>
      {size ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-[var(--muted)]">Size</dt>
          <dd>{ptToMm(size.width_pt).toFixed(1)} × {ptToMm(size.height_pt).toFixed(1)} mm</dd>
        </dl>
      ) : (
        <p className="text-[var(--muted)]">No document open.</p>
      )}
      <p className="mt-6 text-[var(--muted)]">Layout controls (rows, columns, gap) arrive with the grid milestone.</p>
    </aside>
  );
}
