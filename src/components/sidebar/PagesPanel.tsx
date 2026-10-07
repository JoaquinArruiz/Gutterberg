import { useEffect, useRef, useState } from "react";
import { pageBadge } from "../../lib/document-layout";
import { usePageImage } from "../../lib/use-page-image";
import type { PanelOrientation } from "../../lib/workspace-layout";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { ApplyGridDialog } from "./ApplyGridDialog";

const THUMB_WIDTH = 120; // vertical list: fixed width
const THUMB_HEIGHT = 84; // horizontal strip: fixed height, width follows the page aspect

function Thumbnail({ index, orientation }: { index: number; orientation: PanelOrientation }) {
  const path = useDocumentStore((s) => s.path);
  const size = useDocumentStore((s) => s.pages[index]);
  const viewed = useDocumentStore((s) => s.currentPage);
  const active = viewed === index;
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const skipped = useLayoutStore((s) =>
    s.groups.some((g) => g.kind === "skip" && g.pages.first <= index && index <= g.pages.last),
  );
  // A different group than the viewed page's: say which, so sections are easy to tell apart.
  const badge = useLayoutStore((s) => pageBadge(s.groups, index, viewed));
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
  const widthCss = orientation === "vertical" ? THUMB_WIDTH : (THUMB_HEIGHT * size.width_pt) / size.height_pt;
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
          {url && <img src={url} alt={`Page ${index + 1}`} draggable={false} className="h-full w-full" />}
        </div>
        <span className="text-[11px] text-[var(--muted)]">{index + 1}</span>
      </button>
      <label
        title={skipped ? "Skipped: left out of the export" : "Included in the export"}
        className="absolute left-2 top-2 flex items-center rounded bg-black/60 p-0.5"
      >
        <input
          type="checkbox"
          aria-label={`Include page ${index + 1}`}
          checked={!skipped}
          onChange={(e) => setSkipped(index, !e.target.checked)}
        />
      </label>
      {badge && (
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

/**
 * Page thumbnails. Same component everywhere; `orientation` (derived from the
 * panel's position) only decides whether they stack vertically or run in a
 * horizontal strip.
 */
export function PagesPanel({ orientation }: { orientation: PanelOrientation }) {
  const count = useDocumentStore((s) => s.pages.length);
  const [applyOpen, setApplyOpen] = useState(false);
  const vertical = orientation === "vertical";
  return (
    <div className={`flex h-full ${vertical ? "flex-col" : "flex-row items-start"}`}>
      {count > 0 && (
        <div className={`shrink-0 ${vertical ? "px-2 pb-1" : "px-1"}`}>
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="w-full whitespace-nowrap rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--hover)]"
          >
            Apply this grid to…
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
