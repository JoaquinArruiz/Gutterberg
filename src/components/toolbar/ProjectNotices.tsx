import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatError } from "../../lib/errors";
import { useProjectStore } from "../../stores/project-store";

/**
 * What went wrong or needs a look when a project is opened or saved: a file that is not a project, a project
 * from a newer version, a PDF that changed. Shown under the toolbar until each message is closed.
 */
export function ProjectNotices() {
  const { t } = useTranslation();
  const notices = useProjectStore((s) => s.notices);
  const dismiss = useProjectStore((s) => s.dismissNotice);
  if (notices.length === 0) return null;
  return (
    <section aria-label={t("project.notices.label")} className="flex shrink-0 flex-col">
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 border-b border-[var(--border)] px-3 py-1.5 ${n.tone === "error" ? "bg-red-500/15 text-red-300" : "bg-amber-400/15 text-amber-200"}`}
        >
          <span className="min-w-0 flex-1">
            {n.error
              ? formatError(n.error)
              : n.key === "pdfChanged"
                ? t("project.notices.pdfChanged", n.values)
                : n.key === "imageChanged"
                  ? t("project.notices.imageChanged", n.values)
                  : n.key === "imagesMissing"
                    ? t("project.notices.imagesMissing", n.values)
                    : t("project.notices.layoutReset", n.values)}
          </span>
          <button
            type="button"
            aria-label={t("project.notices.close")}
            onClick={() => dismiss(n.id)}
            className="rounded p-0.5 hover:bg-[var(--hover)]"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </section>
  );
}
