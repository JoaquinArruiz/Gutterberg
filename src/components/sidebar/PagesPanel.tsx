import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pageBadge } from "../../lib/document-layout";
import { activateDocument, addPdfDialog, removeActiveDocument } from "../../lib/project-actions";
import { usePageImage } from "../../lib/use-page-image";
import { PAGE_THUMB_HEIGHT, type PanelOrientation } from "../../lib/workspace-layout";
import { fileName, useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { Checkbox } from "../ui/Checkbox";
import { Select } from "../ui/Select";
import { ApplyGridDialog } from "./ApplyGridDialog";

const THUMB_WIDTH = 120; // vertical list: fixed width

function Thumbnail({ index, orientation }: { index: number; orientation: PanelOrientation }) {
  const { t } = useTranslation();
  const path = useDocumentStore((s) => s.path);
  const size = useDocumentStore((s) => s.pages[index]);
  const viewed = useDocumentStore((s) => s.currentPage);
  const active = viewed === index;
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const skipped = useLayoutStore((s) =>
    s.groups.some((g) => g.kind === "skip" && g.pages.first <= index && index <= g.pages.last),
  );
  // A different group than the viewed page's: say which, so sections are easy to tell apart.
  const badge = useLayoutStore((s) => pageBadge(s.groups, index, viewed, s.freeform));
  const setSkipped = useLayoutStore((s) => s.setSkipped);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Only render thumbnails that scroll into view (PnP PDFs can have 100+ pages).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const dpr = window.devicePixelRatio || 1;
  const widthCss = orientation === "vertical" ? THUMB_WIDTH : (PAGE_THUMB_HEIGHT * size.width_pt) / size.height_pt;
  const url = usePageImage(visible ? path : null, index, Math.round(widthCss * dpr), 0, "thumbnail");

  return (
    <div
      ref={ref}
      className={`relative flex shrink-0 flex-col items-center rounded ${orientation === "vertical" ? "mx-auto w-[132px]" : ""} ${active ? "bg-[var(--accent)]/20 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"}`}
    >
      <button
        type="button"
        onClick={() => setCurrentPage(index)}
        className="flex flex-col items-center gap-1 rounded p-1.5"
      >
        <div
          className={`bg-white/5 ${skipped ? "opacity-35" : ""}`}
          style={{ width: widthCss, aspectRatio: `${size.width_pt} / ${size.height_pt}` }}
        >
          {url && (
            <img src={url} alt={t("common.page", { n: index + 1 })} draggable={false} className="h-full w-full" />
          )}
        </div>
        <span className="text-[11px] text-[var(--muted)]">{index + 1}</span>
      </button>
      <div
        title={skipped ? t("pages.skippedTitle") : t("pages.includedTitle")}
        className="absolute left-2 top-2 flex items-center rounded bg-black/60 p-0.5"
      >
        <Checkbox
          aria-label={t("pages.include", { n: index + 1 })}
          checked={!skipped}
          onChange={(include) => setSkipped(index, !include)}
        />
      </div>
      {badge && (
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

/** Which PDF of the project is being edited, and the button that adds another. */
function DocumentSwitcher() {
  const { t } = useTranslation();
  const documents = useDocumentStore((s) => s.documents);
  const activeId = useDocumentStore((s) => s.activeId);
  const loading = useDocumentStore((s) => s.loading);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="document-switcher">
      {documents.length > 1 && (
        <Select
          className="min-w-0 [&>button]:w-full [&>button]:min-w-0"
          label={t("pages.document")}
          value={String(activeId)}
          onChange={(id) => activateDocument(Number(id))}
          options={documents.map((d) => ({ value: String(d.id), label: fileName(d.path) }))}
        />
      )}
      <button
        type="button"
        onClick={() => void addPdfDialog()}
        disabled={loading}
        title={t("pages.addPdfTitle")}
        className="w-full whitespace-nowrap rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--hover)] disabled:opacity-40"
      >
        {t("pages.addPdf")}
      </button>
      <button
        type="button"
        onClick={() => void removeActiveDocument()}
        disabled={loading}
        title={t("toolbar.docName.remove")}
        className="w-full whitespace-nowrap rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--hover)] disabled:opacity-40"
      >
        {t("pages.removePdf")}
      </button>
    </div>
  );
}

/**
 * Page thumbnails. Same component everywhere; `orientation` (derived from the
 * panel's position) only decides whether they stack vertically or run in a
 * horizontal strip.
 */
export function PagesPanel({ orientation }: { orientation: PanelOrientation }) {
  const { t } = useTranslation();
  const count = useDocumentStore((s) => s.pages.length);
  const [applyOpen, setApplyOpen] = useState(false);
  const vertical = orientation === "vertical";
  return (
    <div className={`flex h-full ${vertical ? "flex-col" : "flex-row items-start"}`}>
      {count > 0 && (
        <div className={`flex shrink-0 gap-1 ${vertical ? "flex-col px-2 pb-1" : "w-44 flex-col px-1"}`}>
          <DocumentSwitcher />
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="w-full whitespace-nowrap rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--hover)]"
          >
            {t("pages.applyGrid")}
          </button>
          <ApplyGridDialog open={applyOpen} onClose={() => setApplyOpen(false)} />
        </div>
      )}
      <div
        className={`flex min-h-0 min-w-0 flex-1 gap-1 pb-2 ${vertical ? "flex-col overflow-y-auto" : "flex-row items-start overflow-x-auto px-1"}`}
        data-testid="pages-list"
      >
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: pages have no id; the index is their identity
          <Thumbnail key={i} index={i} orientation={orientation} />
        ))}
      </div>
    </div>
  );
}
