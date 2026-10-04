import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { usePageImage } from "../../lib/use-page-image";

const THUMB_WIDTH = 120;

function Thumbnail({ index }: { index: number }) {
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
  const url = usePageImage(visible ? path : null, index, Math.round(THUMB_WIDTH * dpr));
  const size = pages[index];
  const active = index === currentPage;

  return (
    <button
      ref={ref}
      onClick={() => setCurrentPage(index)}
      className={`mx-auto flex w-[132px] flex-col items-center gap-1 rounded p-1.5 ${active ? "bg-[var(--accent)]/20 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"}`}
    >
      <div
        className="w-[120px] bg-white/5"
        style={{ aspectRatio: `${size.width_pt} / ${size.height_pt}` }}
      >
        {url && <img src={url} draggable={false} className="h-full w-full" />}
      </div>
      <span className="text-[11px] text-[var(--muted)]">{index + 1}</span>
    </button>
  );
}

export function PagesSidebar() {
  const pages = useDocumentStore((s) => s.pages);
  return (
    <aside className="flex h-full flex-col bg-[var(--panel)]">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Pages</div>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto pb-2">
        {pages.map((_, i) => (
          <Thumbnail key={i} index={i} />
        ))}
      </div>
    </aside>
  );
}
