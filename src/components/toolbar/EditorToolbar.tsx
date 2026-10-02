import { Download, FileText, Hand, Maximize, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { useLayoutStore } from "../../stores/layout-store";
import { exportDocument, pickExportPath } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore, type Tool, type ViewMode } from "../../stores/editor-store";
import { zoomActions } from "../../lib/zoom-actions";

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: "select", label: "Select", key: "V", Icon: MousePointer2 },
  { id: "pan", label: "Pan", key: "H", Icon: Hand },
];

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "output", label: "Output" },
];

const btn = "flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40";

export function EditorToolbar() {
  const { openDialog, pages, loading, path } = useDocumentStore();
  const { selection } = useEditorStore();
  const { rows, columns, gapMm, result } = useLayoutStore();
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = async () => {
    if (!path || !selection) return;
    try {
      const out = await pickExportPath(path);
      if (!out) return;
      setExporting(true);
      setStatus(null);
      const n = await exportDocument({ bounds: selection, rows, columns, gap_mm: gapMm }, pages.length, out);
      setStatus({ ok: true, text: `Exported ${n} page${n === 1 ? "" : "s"} to ${out}` });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setExporting(false);
    }
  };

  const { tool, setTool, viewMode, setViewMode } = useEditorStore();
  const { zoomIn, zoomOut, fitPage } = zoomActions;
  const empty = pages.length === 0;
  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2">
      <button onClick={openDialog} disabled={loading} className={btn}>
        <FileText size={14} /> Open PDF
      </button>
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          title={`${label} (${key})`}
          onClick={() => setTool(id)}
          className={`${btn} ${tool === id ? "bg-white/15" : ""}`}
        >
          <Icon size={14} />
        </button>
      ))}
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      <button title="Zoom out (-)" onClick={zoomOut} disabled={empty} className={btn}><ZoomOut size={14} /></button>
      <button title="Zoom in (+)" onClick={zoomIn} disabled={empty} className={btn}><ZoomIn size={14} /></button>
      <button title="Fit page (0)" onClick={fitPage} disabled={empty} className={btn}><Maximize size={14} /></button>
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => setViewMode(id)}
          disabled={empty}
          className={`${btn} ${viewMode === id ? "bg-white/15" : ""}`}
        >
          {label}
        </button>
      ))}
      <div className="flex-1" />
      {status && (
        <span title={status.text} className={`mr-2 max-w-[40ch] truncate text-[11px] ${status.ok ? "text-[var(--muted)]" : "text-red-400"}`}>
          {status.text}
        </span>
      )}
      <button
        onClick={doExport}
        disabled={!selection || !result || exporting}
        title={selection ? (result ? "Export PDF" : "The layout does not fit the page") : "Select the card region first"}
        className="flex items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1 font-medium text-black disabled:opacity-40"
      >
        <Download size={14} /> {exporting ? "Exporting…" : "Export PDF"}
      </button>
    </header>
  );
}
