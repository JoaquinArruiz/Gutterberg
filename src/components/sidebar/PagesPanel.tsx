import { useEffect, useRef, useState } from "react";
import { usePageImage } from "../../lib/use-page-image";
import type { PanelOrientation } from "../../lib/workspace-layout";
import { useDocumentStore } from "../../stores/document-store";

const THUMB_WIDTH = 120; // vertical list: fixed width
const THUMB_HEIGHT = 84; // horizontal strip: fixed height, width follows the page aspect

function Thumbnail({ index, orientation }: { index: number; orientation: PanelOrientation }) {
  const { path, pages, currentPage, setCurrentPage } = useDocumentStore();
  const ref = useRef<HTMLButtonElement>(null);
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
  const size = pages[index];
  const widthCss = orientation === "vertical" ? THUMB_WIDTH : (THUMB_HEIGHT * size.width_pt) / size.height_pt;
  const url = usePageImage(visible ? path : null, index, Math.round(widthCss * dpr));
  const active = index === currentPage;

  return (
    <button
      type="button"
      ref={ref}
      onClick={() => setCurrentPage(index)}
      className={`flex shrink-0 flex-col items-center gap-1 rounded p-1.5 ${orientation === "vertical" ? "mx-auto w-[132px]" : ""} ${active ? "bg-[var(--accent)]/20 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"}`}
    >
      <div className="bg-white/5" style={{ width: widthCss, aspectRatio: `${size.width_pt} / ${size.height_pt}` }}>
        {url && <img src={url} alt={`Page ${index + 1}`} draggable={false} className="h-full w-full" />}
      </div>
      <span className="text-[11px] text-[var(--muted)]">{index + 1}</span>
    </button>
  );
}

/**
 * Page thumbnails. Same component everywhere; `orientation` (derived from the
 * panel's position) only decides whether they stack vertically or run in a
 * horizontal strip.
 */
export function PagesPanel({ orientation }: { orientation: PanelOrientation }) {
  const pages = useDocumentStore((s) => s.pages);
  const vertical = orientation === "vertical";
  return (
    <div
      className={`flex h-full gap-1 pb-2 ${vertical ? "flex-col overflow-y-auto" : "flex-row items-start overflow-x-auto px-1"}`}
      data-testid="pages-list"
    >
      {pages.map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pages have no id; the index is their identity
        <Thumbnail key={i} index={i} orientation={orientation} />
      ))}
    </div>
  );
}
