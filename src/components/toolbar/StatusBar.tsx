import { useTranslation } from "react-i18next";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { projectName, useProjectStore } from "../../stores/project-store";

export function StatusBar() {
  const { t } = useTranslation();
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const path = useDocumentStore((s) => s.path);
  const projectPath = useProjectStore((s) => s.path);
  const dirty = useProjectStore((s) => s.dirty);
  const name = projectName(projectPath);
  const zoom = useEditorStore((s) => s.viewport.zoom);
  return (
    <footer className="flex h-6 shrink-0 items-center gap-6 border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <span>
        {pages.length ? t("status.page", { current: currentPage + 1, total: pages.length }) : t("status.noDocument")}
      </span>
      <span className="min-w-0 flex-1 truncate">{path}</span>
      {pages.length > 0 && (
        <span className="max-w-[30ch] truncate" title={projectPath ?? undefined}>
          {name ?? t("project.unsaved")}
          {dirty ? " •" : ""}
        </span>
      )}
      {pages.length > 0 && <span>{t("status.zoom", { percent: Math.round(zoom * 100) })}</span>}
    </footer>
  );
}
