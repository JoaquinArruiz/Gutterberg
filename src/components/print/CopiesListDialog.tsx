import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CardId, cardIdKey, documentLetter, pieceReference } from "../../lib/card";
import { copiesFor, parseCopiesList } from "../../lib/copies-list";
import { useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";

/**
 * Copies from a pasted list: one line per piece, in the library's order (the picked pieces, or every piece shown),
 * each with its number of copies. Each piece is listed beside the line it gets before anything is applied.
 */
export function CopiesListDialog({ open, onClose, pieces }: { open: boolean; onClose: () => void; pieces: CardId[] }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const setQuantities = usePrintStore((s) => s.setQuantities);
  const documentIds = useDocumentStore((s) => s.documents.map((d) => d.id).join(","));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setText("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const list = useMemo(() => parseCopiesList(text), [text]);
  const ids = documentIds.split(",").map(Number);
  const rows = Math.max(pieces.length, list.lines.length);
  const name = (id: CardId) => pieceReference(id, documentLetter(ids, id.document_id));

  return (
    <dialog
      ref={ref}
      aria-label={t("library.copiesList.title")}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[520px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <h2 className="mb-1 text-sm font-semibold">{t("library.copiesList.title")}</h2>
      <p className="mb-2 text-[var(--muted)]">{t("library.copiesList.intro", { count: pieces.length })}</p>
      <textarea
        aria-label={t("library.copiesList.paste")}
        placeholder={t("library.copiesList.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[12px]"
      />
      {list.lines.length > 0 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded border border-[var(--border)]">
          <table className="w-full text-[12px]" aria-label={t("library.copiesList.check")}>
            <thead className="sticky top-0 bg-[var(--panel)] text-left text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1 font-normal">{t("library.copiesList.piece")}</th>
                <th className="px-2 py-1 font-normal">{t("library.copiesList.line")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("library.copies")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => {
                const piece = pieces[i];
                const line = list.lines[i];
                return (
                  <tr key={piece ? cardIdKey(piece) : `line-${i}`} className="border-t border-[var(--border)]">
                    <td className="px-2 py-0.5">{piece ? name(piece) : t("library.copiesList.noPiece")}</td>
                    <td className="px-2 py-0.5 text-[var(--muted)]">
                      {line ? line.label : t("library.copiesList.unchanged")}
                    </td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{line && piece ? line.copies : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(list.skipped > 0 || list.lines.length > pieces.length) && (
        <p role="status" className="mt-2 text-[var(--muted)]">
          {[
            list.skipped > 0 ? t("library.copiesList.skipped", { count: list.skipped }) : null,
            list.lines.length > pieces.length
              ? t("library.copiesList.extra", { count: list.lines.length - pieces.length })
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="md" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="md"
          disabled={list.lines.length === 0 || pieces.length === 0}
          onClick={() => {
            setQuantities(copiesFor(pieces.map(cardIdKey), list));
            onClose();
          }}
        >
          {t("common.apply")}
        </Button>
      </div>
    </dialog>
  );
}
