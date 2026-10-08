import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { removeActiveDocument } from "../../lib/project-actions";
import { fileName, useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";

const iconBtn = "flex shrink-0 items-center rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40";

/** What a file name cannot contain, and a trailing ".pdf" the user typed out of habit. */
const cleanName = (raw: string) =>
  raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\.pdf$/i, "")
    .trim();

/**
 * The toolbar's PDF name. Source tab: the PDF being edited, with a button to remove it from the project.
 * Print tab: the name the exported PDF will get, editable by clicking it.
 */
export function DocumentName() {
  const { t } = useTranslation();
  const stage = useUiStore((s) => s.stage);
  const path = useDocumentStore((s) => s.path);
  const exportName = usePrintStore((s) => s.exportName);
  const setExportName = usePrintStore((s) => s.setExportName);
  const [draft, setDraft] = useState<string | null>(null);
  if (!path) return null;

  if (stage === "cards") {
    const name = fileName(path);
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span title={path} className="min-w-0 truncate">
          {name}
        </span>
        <button
          type="button"
          title={t("toolbar.docName.remove")}
          aria-label={t("toolbar.docName.remove")}
          onClick={() => void removeActiveDocument()}
          className={iconBtn}
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  const shown = exportName ?? t("files.newPdfName");
  const commit = () => {
    if (draft === null) return;
    const name = cleanName(draft);
    setExportName(name === "" || name === t("files.newPdfName") ? null : name);
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <div className="flex min-w-0 items-center gap-0.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: the field was just opened by clicking the name
          autoFocus
          aria-label={t("toolbar.docName.label")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setDraft(null);
          }}
          className="w-48 min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5"
        />
        <span className="shrink-0 text-[var(--muted)]">.pdf</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      title={t("toolbar.docName.rename")}
      onClick={() => setDraft(shown)}
      className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--hover)]"
    >
      <span className="min-w-0 truncate">{shown}.pdf</span>
      <Pencil size={12} className="shrink-0 text-[var(--muted)]" />
    </button>
  );
}
