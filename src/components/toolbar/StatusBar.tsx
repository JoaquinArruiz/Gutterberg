import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";

export function StatusBar() {
  const { pages, currentPage, path } = useDocumentStore();
  const zoom = useEditorStore((s) => s.viewport.zoom);
  return (
    <footer className="flex h-6 shrink-0 items-center gap-6 border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <span>{pages.length ? `Page ${currentPage + 1} / ${pages.length}` : "No document"}</span>
      <span className="min-w-0 flex-1 truncate">{path}</span>
      {pages.length > 0 && <span>Zoom {Math.round(zoom * 100)}%</span>}
    </footer>
  );
}
