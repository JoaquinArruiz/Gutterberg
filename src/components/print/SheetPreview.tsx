import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CSS_PX_PER_PT } from "../../lib/coordinates";
import type { SheetPlacement } from "../../lib/sheet-api";
import { useCardImage } from "../../lib/use-card-image";
import { useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";

const PAD = 24;
const MAX_ZOOM_PX_PER_PT = 16 * CSS_PX_PER_PT;

/**
 * One card on the sheet: the crop of its source area, turned and sized as the exporter will place
 * it. The image is only for display; the exported file keeps the original vector content.
 */
function PlacedCard({ p, k }: { p: SheetPlacement; k: number }) {
  const path = useDocumentStore((s) => s.path);
  const page = useDocumentStore((s) => s.pages[p.card_id.page_index]);
  const d = p.destination;
  // The image is upright and keeps the source's own shape; a quarter turn swaps the box it fills.
  const quarter = p.turn === 90 || p.turn === 270;
  const [w, h] = quarter ? [d.height * k, d.width * k] : [d.width * k, d.height * k];
  const dpr = window.devicePixelRatio || 1;
  const url = useCardImage(path, p.card_id, p.source, page, w * dpr, "page");
  return (
    <div
      className="absolute overflow-hidden bg-white"
      style={{ left: d.x * k, top: d.y * k, width: d.width * k, height: d.height * k }}
    >
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            maxWidth: "none",
            width: w,
            height: h,
            left: (d.width * k - w) / 2,
            top: (d.height * k - h) / 2,
            transform: p.turn ? `rotate(${p.turn}deg)` : undefined,
          }}
        />
      )}
    </div>
  );
}

/** The sheets the plan produces, one at a time, fitted into the pane. */
export function SheetPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  const sheets = usePrintStore((s) => s.sheets);
  const error = usePrintStore((s) => s.sheetsError);
  const current = usePrintStore((s) => s.currentSheet);
  const setCurrent = usePrintStore((s) => s.setCurrentSheet);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pane exists once a document is open
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDocument]);

  const sheet = sheets?.[current];
  const total = sheets?.length ?? 0;
  const cardCount = sheets?.reduce((n, s) => n + s.placements.length, 0) ?? 0;

  let content: React.ReactNode = null;
  if (sheet && box.width > 0) {
    const k = Math.min(
      MAX_ZOOM_PX_PER_PT,
      Math.max(
        0.01,
        Math.min((box.width - PAD * 2) / sheet.page.width_pt, (box.height - PAD * 2) / sheet.page.height_pt),
      ),
    );
    content = (
      <div
        className="absolute bg-white shadow-lg shadow-black/50"
        style={{
          left: (box.width - sheet.page.width_pt * k) / 2,
          top: (box.height - sheet.page.height_pt * k) / 2,
          width: sheet.page.width_pt * k,
          height: sheet.page.height_pt * k,
        }}
        data-testid="sheet-page"
      >
        {sheet.placements.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a card can appear many times on a sheet; its slot is its identity
          <PlacedCard key={i} p={p} k={k} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="sheet-preview">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3">
        <button
          type="button"
          aria-label="Previous sheet"
          disabled={current <= 0}
          onClick={() => setCurrent(current - 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums" data-testid="sheet-position">
          {total > 0 ? `Sheet ${current + 1} of ${total}` : "No sheets"}
        </span>
        <button
          type="button"
          aria-label="Next sheet"
          disabled={current >= total - 1}
          onClick={() => setCurrent(current + 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
        <span className="ml-auto text-[var(--muted)]" data-testid="sheet-summary">
          {total} sheet{total === 1 ? "" : "s"}, {cardCount} card{cardCount === 1 ? "" : "s"}
        </span>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]">
        {!hasDocument ? (
          <Message>Open a PDF to plan the sheets.</Message>
        ) : error ? (
          <Message tone="error">{error}</Message>
        ) : total === 0 ? (
          <Message>
            Nothing to print yet. Choose cards in the library and give them copies, or switch the plan back to all
            cards.
          </Message>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function Message({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <p
      className={`absolute inset-x-0 top-6 mx-auto w-fit max-w-[80%] rounded bg-black/75 px-3 py-1.5 text-center ${tone === "error" ? "text-red-300" : "text-[var(--muted)]"}`}
    >
      {tone === "error" ? "⚠ " : ""}
      {children}
    </p>
  );
}
