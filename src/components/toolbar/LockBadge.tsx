import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { documentName, type OpenDocument } from "../../stores/document-store";

/**
 * A small lock when the publisher of a PDF restricted it. Red when the export will refuse it (printing or
 * modifying is locked), amber when the export goes ahead and keeps the restrictions. The hover text says which
 * PDF and why. Nothing is drawn for PDFs without restrictions.
 */
export function LockBadge({ documents }: { documents: OpenDocument[] }) {
  const { t } = useTranslation();
  const refused = documents.filter((d) => d.access?.locked);
  const restricted = documents.filter((d) => d.access?.restricted && !d.access.locked);
  if (refused.length === 0 && restricted.length === 0) return null;
  const lines = [
    ...refused.map((d) =>
      t(d.access?.locked === "printing" ? "lock.printing" : "lock.modifying", { name: documentName(d) }),
    ),
    ...restricted.map((d) => t("lock.restrictedNote", { name: documentName(d) })),
  ];
  const text = lines.join("\n");
  return (
    <span
      role="img"
      data-testid="lock-badge"
      title={text}
      aria-label={text}
      className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
        refused.length > 0 ? "border-red-400/60 text-red-300" : "border-amber-400/60 text-amber-300"
      }`}
    >
      <Lock size={11} />
      {refused.length > 0 ? t("lock.locked") : t("lock.restricted")}
    </span>
  );
}
