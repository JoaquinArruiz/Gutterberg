import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { removeActiveDocument } from "../../lib/project-actions";
import { documentName, useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";

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
  const images = useDocumentStore((s) => s.documents.find((d) => d.id === s.activeId)?.images);
  const activeId = useDocumentStore((s) => s.activeId);
  const renameImages = useDocumentStore((s) => s.renameImages);
  const [renaming, setRenaming] = useState<string | null>(null);
  const exportName = usePrintStore((s) => s.exportName);
  const setExportName = usePrintStore((s) => s.setExportName);
  const [draft, setDraft] = useState<string | null>(null);
  if (!path) return null;

  if (stage === "cards") {
    const name = documentName({ path, images });
    const commitName = () => {
      if (renaming === null) return;
      const next = renaming.replace(/[\\/:*?"<>|]/g, "").trim();
      if (next !== "") renameImages(activeId, next);
      setRenaming(null);
    };
    return (
      <div className="flex min-w-0 items-center gap-1">
        {images && renaming !== null ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the field was just opened by clicking the rename button
            autoFocus
            aria-label={t("toolbar.docName.labelImages")}
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") setRenaming(null);
            }}
            className="w-48 min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5"
          />
        ) : (
          <span title={images ? name : path} className="min-w-0 truncate">
            {name}
          </span>
        )}
        {images && renaming === null && (
          <Button
            variant="ghost"
            className="shrink-0"
            title={t("toolbar.docName.renameImages")}
            aria-label={t("toolbar.docName.renameImages")}
            onClick={() => setRenaming(name)}
          >
            <Pencil size={13} />
          </Button>
        )}
        <Button
          variant="ghost"
          className="shrink-0"
          title={t("toolbar.docName.remove")}
          aria-label={t("toolbar.docName.remove")}
          onClick={() => void removeActiveDocument()}
        >
          <Trash2 size={13} />
        </Button>
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
