import { useTranslation } from "react-i18next";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { projectName, useProjectStore } from "../../stores/project-store";
import { sheetViewport, useSheetViewStore } from "../../stores/sheet-view-store";
import { useUiStore } from "../../stores/ui-store";

export function StatusBar() {
  const { t } = useTranslation();
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const path = useDocumentStore((s) => s.path);
  const projectPath = useProjectStore((s) => s.path);
  const dirty = useProjectStore((s) => s.dirty);
  const name = projectName(projectPath);
  // On the Print tab the zoom is the large sheet's.
  const print = useUiStore((s) => s.stage === "print");
  const editorZoom = useEditorStore((s) => s.viewport.zoom);
  const sheetZoom = useSheetViewStore((s) => (s.page ? sheetViewport(s.view, s.box, s.page).zoom : null));
  const zoom = print ? sheetZoom : editorZoom;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-6 border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      {pages.length > 0 && <span>{t("status.page", { current: currentPage + 1, total: pages.length })}</span>}
      <span className="min-w-0 flex-1 truncate">{path}</span>
      {pages.length > 0 && (
        <span className="max-w-[30ch] truncate" title={projectPath ?? undefined}>
          {name ?? t("project.unsaved")}
          {dirty ? " •" : ""}
        </span>
      )}
      {pages.length > 0 && zoom !== null && <span>{t("status.zoom", { percent: Math.round(zoom * 100) })}</span>}
    </footer>
  );
}
