import { FileText, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openPdfDialog, openProjectDialog } from "../../lib/project-actions";
import { fileName, useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { BrandLogo } from "../ui/BrandLogo";
import { Button } from "../ui/Button";

/** The folder a file is in, for telling two projects with the same name apart. */
const folderOf = (path: string) =>
  path.slice(0, Math.max(0, path.length - fileName(path).length)).replace(/[\\/]$/, "");

/**
 * What the app shows while nothing is open: open a PDF, open a project, or pick up a recent project. It replaces the
 * editor and its panels, which have nothing to show yet.
 */
export function StartScreen() {
  const { t } = useTranslation();
  const loading = useDocumentStore((s) => s.loading);
  const recent = usePreferencesStore((s) => s.prefs.files.recent);
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl";
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-6" data-testid="start-screen">
      <div className="flex w-full max-w-md flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-20 w-auto" />
          <h1 className="text-base font-semibold">{t("start.title")}</h1>
          <p className="text-[var(--muted)]">{loading ? t("viewport.opening") : t("start.lead")}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="primary"
            size="md"
            className="flex items-center gap-2"
            disabled={loading}
            onClick={() => void openPdfDialog()}
          >
            <FileText size={14} />
            {t("project.menu.openPdf")}
            <span className="font-normal opacity-70">{`${mod}+O`}</span>
          </Button>
          <Button
            size="md"
            className="flex items-center gap-2"
            disabled={loading}
            onClick={() => void openProjectDialog()}
          >
            <FolderOpen size={14} />
            {t("project.menu.openProject")}
            <span className="text-[var(--muted)]">{`${mod}+Shift+O`}</span>
          </Button>
        </div>

        <section aria-label={t("project.menu.recent")}>
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t("project.menu.recent")}
          </h2>
          {recent.length === 0 ? (
            <p className="text-[var(--muted)]">{t("project.menu.noRecent")}</p>
          ) : (
            <ul>
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    title={path}
                    disabled={loading}
                    onClick={() => void openProjectDialog(path)}
                    className="flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-[var(--hover)] disabled:opacity-40"
                  >
                    <span className="shrink-0">{fileName(path)}</span>
                    <span className="min-w-0 truncate text-[11px] text-[var(--muted)]">{folderOf(path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-[var(--muted)]">{t("start.shortcuts")}</p>
      </div>
    </div>
  );
}
