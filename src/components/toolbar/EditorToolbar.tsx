import { Download, FileText, Hand, Maximize, MousePointer2, Settings, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { WORKSPACE_LABEL } from "../../lib/preferences";
import { exportDocument, pickExportPath } from "../../lib/tauri";
import { switchWorkspace } from "../../lib/workspace";
import { zoomActions } from "../../lib/zoom-actions";
import { useDocumentStore } from "../../stores/document-store";
import { type Tool, useEditorStore } from "../../stores/editor-store";
import { gridPayload, useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { PanelsMenu } from "../workspace/PanelsMenu";

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: "select", label: "Select", key: "V", Icon: MousePointer2 },
  { id: "pan", label: "Pan", key: "H", Icon: Hand },
];

const btn = "flex items-center gap-1.5 rounded px-2 py-1 hover:bg-[var(--hover)] disabled:opacity-40";

export function EditorToolbar() {
  const openDialog = useDocumentStore((s) => s.openDialog);
  const pages = useDocumentStore((s) => s.pages);
  const loading = useDocumentStore((s) => s.loading);
  const path = useDocumentStore((s) => s.path);
  const selection = useEditorStore((s) => s.selection);
  const result = useLayoutStore((s) => s.result);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = async () => {
    if (!path || !selection) return;
    try {
      const out = await pickExportPath(path);
      if (!out) return;
      setExporting(true);
      setStatus(null);
      const n = await exportDocument(gridPayload(selection, useLayoutStore.getState()), pages.length, out);
      setStatus({ ok: true, text: `Exported ${n} page${n === 1 ? "" : "s"} to ${out}` });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setExporting(false);
    }
  };

  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const viewMode = useEditorStore((s) => s.viewMode);
  // The switcher is the ordered list from Preferences; with a single view there is nothing to switch.
  const visibleModes = usePreferencesStore((s) => s.prefs.workspace.visibleModes);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const { zoomIn, zoomOut, fitPage } = zoomActions;
  const empty = pages.length === 0;
  return (
    <header className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2">
      <button type="button" onClick={openDialog} disabled={loading} className={btn}>
        <FileText size={14} /> Open PDF
      </button>
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button
          type="button"
          key={id}
          title={`${label} (${key})`}
          onClick={() => setTool(id)}
          className={`${btn} ${tool === id ? "bg-[var(--active)]" : ""}`}
        >
          <Icon size={14} />
        </button>
      ))}
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      <button type="button" title="Zoom out (-)" onClick={zoomOut} disabled={empty} className={btn}>
        <ZoomOut size={14} />
      </button>
      <button type="button" title="Zoom in (+)" onClick={zoomIn} disabled={empty} className={btn}>
        <ZoomIn size={14} />
      </button>
      <button type="button" title="Fit page (0)" onClick={fitPage} disabled={empty} className={btn}>
        <Maximize size={14} />
      </button>
      <div className="mx-2 h-4 w-px bg-[var(--border)]" />
      {visibleModes.length > 1 && (
        <div role="tablist" aria-label="Workspace" className="flex items-center gap-1">
          {visibleModes.map((id) => (
            <button
              type="button"
              key={id}
              role="tab"
              aria-selected={viewMode === id}
              onClick={() => {
                switchWorkspace(id);
                // Clicking Output (even when already there) refreshes a manual preview.
                if (id === "output") useLayoutStore.getState().updatePreview();
              }}
              disabled={empty}
              className={`${btn} ${viewMode === id ? "bg-[var(--active)]" : ""}`}
            >
              {WORKSPACE_LABEL[id]}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1" />
      {status && (
        <span
          title={status.text}
          className={`mr-2 max-w-[40ch] truncate text-[11px] ${status.ok ? "text-[var(--muted)]" : "text-red-400"}`}
        >
          {status.text}
        </span>
      )}
      <PanelsMenu />
      <button
        type="button"
        title="Preferences (Ctrl+,)"
        aria-label="Preferences"
        onClick={() => setPrefsOpen(true)}
        className={`${btn} mr-1`}
      >
        <Settings size={14} />
      </button>
      <button
        type="button"
        onClick={doExport}
        disabled={!selection || !result || !!result.overflow || exporting}
        title={
          !selection
            ? "Select the card region first"
            : !result
              ? "The grid is not valid"
              : result.overflow
                ? "The cards do not fit the output page. Change the page, spacing or margins."
                : "Export PDF"
        }
        className="flex items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1 font-medium text-black disabled:opacity-40"
      >
        <Download size={14} /> {exporting ? "Exporting…" : "Export PDF"}
      </button>
    </header>
  );
}
