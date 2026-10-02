import { FileText, Download } from "lucide-react";
import { useDocumentStore } from "../../stores/document-store";

export function EditorToolbar() {
  const { openDialog, pages, loading } = useDocumentStore();
  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2">
      <button
        onClick={openDialog}
        disabled={loading}
        className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/10 disabled:opacity-50"
      >
        <FileText size={14} /> Open PDF
      </button>
      <div className="flex-1" />
      <button
        disabled={pages.length === 0}
        title="Available in a later milestone"
        className="flex items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1 font-medium text-black disabled:opacity-40"
      >
        <Download size={14} /> Export PDF
      </button>
    </header>
  );
}
