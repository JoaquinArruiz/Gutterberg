import { useDocumentStore } from "../../stores/document-store";

export function StatusBar() {
  const { pages, currentPage, path } = useDocumentStore();
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <span>{pages.length ? `Page ${currentPage + 1} / ${pages.length}` : "No document"}</span>
      <span className="truncate pl-4">{path}</span>
    </footer>
  );
}
