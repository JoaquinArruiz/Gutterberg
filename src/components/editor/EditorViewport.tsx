import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { PagePreview } from "./PagePreview";

const PADDING = 24;

export function EditorViewport() {
  const { pages, currentPage, error, loading } = useDocumentStore();
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const size = pages[currentPage];
  // Fit the page inside the viewport (zoom/pan arrive with the selection milestone).
  let w = 0, h = 0;
  if (size && box.w > 0) {
    const scale = Math.min((box.w - PADDING * 2) / size.width_pt, (box.h - PADDING * 2) / size.height_pt);
    w = Math.max(1, Math.floor(size.width_pt * scale));
    h = Math.max(1, Math.floor(size.height_pt * scale));
  }

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center bg-[#15161a]">
      {error ? (
        <p className="max-w-md whitespace-pre-wrap text-red-400">{error}</p>
      ) : size ? (
        <PagePreview widthCss={w} heightCss={h} />
      ) : (
        <p className="text-[var(--muted)]">{loading ? "Opening…" : "Open a PDF to get started (File → Open PDF)"}</p>
      )}
    </div>
  );
}
