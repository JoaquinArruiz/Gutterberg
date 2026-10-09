import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addImagesDialog,
  addPdfDialog,
  newProject,
  openPdfDialog,
  openProjectDialog,
  saveProject,
  saveProjectAs,
} from "../../lib/project-actions";
import { fileName, useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { menuItem, Popover } from "../workspace/Popover";

const shortcut = "ml-auto pl-4 text-[11px] text-[var(--muted)]";

/** The File menu: start, open, add to and save a project, and the recent projects. */
export function FileMenu() {
  const { t } = useTranslation();
  const loading = useDocumentStore((s) => s.loading);
  const hasDocument = useDocumentStore((s) => s.documents.length > 0);
  const recent = usePreferencesStore((s) => s.prefs.files.recent);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);

  const item = (label: string, keys: string, action: () => void, close: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className={menuItem}
      disabled={disabled || loading}
      onClick={() => {
        close();
        action();
      }}
    >
      {label}
      {keys && <span className={shortcut}>{keys}</span>}
    </button>
  );

  return (
    <Popover
      label={t("project.menu.file")}
      testId="file-menu"
      align="left"
      triggerClassName="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 hover:bg-[var(--hover)] disabled:opacity-40"
      trigger={
        <>
          <FileText size={14} />
          {/* Below 1100px only the icon shows (the name is still its tooltip and accessible name). */}
          <span className="max-[1100px]:sr-only">{t("project.menu.file")}</span>
        </>
      }
    >
      {(close) => (
        <>
          {item(t("project.menu.new"), "Ctrl+N", () => void newProject(), close)}
          {item(t("project.menu.openPdf"), "Ctrl+O", () => void openPdfDialog(), close)}
          {item(t("project.menu.openProject"), "Ctrl+Shift+O", () => void openProjectDialog(), close)}
          {item(t("project.menu.addPdf"), "", () => void addPdfDialog(), close, !hasDocument)}
          {item(t("project.menu.addImages"), "", () => void addImagesDialog(), close)}
          <div className="my-1 border-t border-[var(--border)]" />
          {item(t("project.menu.save"), "Ctrl+S", () => void saveProject(), close, !hasDocument)}
          {item(t("project.menu.saveAs"), "Ctrl+Shift+S", () => void saveProjectAs(), close, !hasDocument)}
          <div className="my-1 border-t border-[var(--border)]" />
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t("project.menu.recent")}
          </div>
          {recent.length === 0 ? (
            <p className="px-2 py-1 text-[var(--muted)]">{t("project.menu.noRecent")}</p>
          ) : (
            recent.map((path) => (
              <button
                key={path}
                type="button"
                role="menuitem"
                title={path}
                className={`${menuItem} max-w-72`}
                disabled={loading}
                onClick={() => {
                  close();
                  void openProjectDialog(path);
                }}
              >
                <span className="truncate">{fileName(path)}</span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              close();
              setShortcutsOpen(true);
            }}
          >
            {t("project.menu.shortcuts")}
            <span className={shortcut}>?</span>
          </button>
        </>
      )}
    </Popover>
  );
}
