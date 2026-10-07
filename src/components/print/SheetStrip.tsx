import { useEffect, useRef, useState } from "react";
import type { OutputSheet } from "../../lib/sheet-api";
import { PlacedCard } from "./PlacedCard";

const THUMB_HEIGHT = 84;

/** One sheet, small. Its cards are only rendered once it scrolls into view (a plan can have dozens of sheets). */
function SheetThumb({
  sheet,
  index,
  active,
  onSelect,
}: {
  sheet: OutputSheet;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keep the shown sheet in view when it changes from elsewhere (the arrows).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [active]);

  const k = THUMB_HEIGHT / sheet.page.height_pt;
  const width = sheet.page.width_pt * k;
  return (
    <button
      type="button"
      ref={ref}
      onClick={onSelect}
      aria-label={`Sheet ${index + 1}`}
      aria-current={active}
      data-testid="sheet-thumb"
      className={`flex shrink-0 flex-col items-center gap-1 rounded p-1.5 ${active ? "bg-[var(--accent)]/20 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"}`}
    >
      <div className="relative bg-white shadow shadow-black/40" style={{ width, height: THUMB_HEIGHT }}>
        {visible &&
          sheet.placements.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a card can appear many times on a sheet; its slot is its identity
            <PlacedCard key={i} p={p} k={k} kind="thumbnail" />
          ))}
      </div>
      <span className="text-[11px] text-[var(--muted)]">{index + 1}</span>
    </button>
  );
}

/** The sheets as a row of small previews, like the page thumbnails of the Cards stage. */
export function SheetStrip({
  sheets,
  current,
  onSelect,
}: {
  sheets: OutputSheet[];
  current: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-2 pb-1 pt-1"
      data-testid="sheet-strip"
    >
      {sheets.map((sheet, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sheets have no id; their position is their identity
        <SheetThumb key={i} sheet={sheet} index={i} active={i === current} onSelect={() => onSelect(i)} />
      ))}
    </div>
  );
}
