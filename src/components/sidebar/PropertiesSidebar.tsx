import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { ptToMm } from "../../lib/units";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-5">
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</div>
    {children}
  </section>
);

const Row = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt className="text-[var(--muted)]">{k}</dt>
    <dd className="tabular-nums">{v}</dd>
  </>
);

export function PropertiesSidebar() {
  const { pages, currentPage } = useDocumentStore();
  const selection = useEditorStore((s) => s.selection);
  const page = pages[currentPage];
  const mm = (n: number, dim: "width_pt" | "height_pt") => ptToMm(n * page[dim]).toFixed(1);
  return (
    <aside className="h-full overflow-y-auto bg-[var(--panel)] p-3">
      <Section title="Page">
        {page ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <Row k="Size" v={`${ptToMm(page.width_pt).toFixed(1)} × ${ptToMm(page.height_pt).toFixed(1)} mm`} />
          </dl>
        ) : (
          <p className="text-[var(--muted)]">No document open.</p>
        )}
      </Section>
      {page && (
        <Section title="Selection">
          {selection ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Row k="X" v={`${mm(selection.x, "width_pt")} mm`} />
              <Row k="Y" v={`${mm(selection.y, "height_pt")} mm`} />
              <Row k="Width" v={`${mm(selection.width, "width_pt")} mm`} />
              <Row k="Height" v={`${mm(selection.height, "height_pt")} mm`} />
            </dl>
          ) : (
            <p className="text-[var(--muted)]">Drag on the page to select the region the cards occupy.</p>
          )}
        </Section>
      )}
    </aside>
  );
}
