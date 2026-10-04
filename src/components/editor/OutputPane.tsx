import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { CSS_PX_PER_PT } from "../../lib/coordinates";
import { usePreviewResult } from "../../lib/view-page";
import { OutputPreview } from "./OutputPreview";
import { OutputNotice } from "./OutputNotice";
import { RefreshPreviewButton } from "./RefreshPreviewButton";

const PAD = 24;

/** Output page fitted into its own pane (split view). No pan/zoom: it answers "what will the sheet look like?". */
export function OutputPane() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const result = usePreviewResult();
  const page = useDocumentStore((s) => s.pages[s.currentPage]);
  const live = useLayoutStore((s) => s.live);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const out = result?.output_page ?? page;
  let content = null;
  if (out && box.width > 0) {
    const k = Math.max(
      0.01,
      Math.min((box.width - PAD * 2) / out.width_pt, (box.height - PAD * 2) / out.height_pt),
    );
    // Same cap as the main viewport so a huge zoom never asks for a giant raster.
    const kk = Math.min(k, 16 * CSS_PX_PER_PT);
    const screen = {
      x: (box.width - out.width_pt * kk) / 2, y: (box.height - out.height_pt * kk) / 2,
      width: out.width_pt * kk, height: out.height_pt * kk,
    };
    content = <OutputPreview screen={screen} k={kk} result={result} />;
  }

  return (
    <div ref={ref} className="relative h-full min-w-0 flex-1 overflow-hidden bg-[var(--canvas)]">
      <div className="pointer-events-none absolute left-2 top-2 z-10 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Output{live ? "" : " (manual)"}
      </div>
      {content}
      <RefreshPreviewButton className="absolute bottom-4 right-4 z-20" />
      <OutputNotice />
    </div>
  );
}
