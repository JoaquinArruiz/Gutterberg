import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CSS_PX_PER_PT } from "../../lib/coordinates";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";
import { RefreshButton } from "../editor/RefreshPreviewButton";
import { HintToast } from "../ui/HintToast";
import { PlacedCard } from "./PlacedCard";
import { SheetStrip } from "./SheetStrip";

const PAD = 24;
const MAX_ZOOM_PX_PER_PT = 16 * CSS_PX_PER_PT;
/** Remembered like the inspector's sections: the strip of sheet previews is open unless the user hid it. */
export const STRIP_SECTION_ID = "print.sheet-strip";

/**
 * The sheets the plan produces: one sheet large, and a row of small previews of all of them
 * (hideable). The large sheet always follows the plan: it is redrawn when copies change and when
 * another sheet is chosen. Only the row of previews obeys Live Preview: with it off, the row shows
 * the sheets as of the last refresh.
 */
export function SheetPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  const live = useLayoutStore((s) => s.live);
  const planned = usePrintStore((s) => s.sheets);
  const snapshot = usePrintStore((s) => s.sheetsSnapshot);
  const error = usePrintStore((s) => s.sheetsError);
  const current = usePrintStore((s) => s.currentSheet);
  const setCurrent = usePrintStore((s) => s.setCurrentSheet);
  const refresh = usePrintStore((s) => s.updateSheetsPreview);
  const stripOpen = usePreferencesStore((s) => s.prefs.inspector.sections[STRIP_SECTION_ID] ?? true);
  const setSectionOpen = usePreferencesStore((s) => s.setSectionOpen);

  // With Live Preview off the row of previews is frozen; the first plan after entering the stage is shown at once.
  const previews = live ? planned : snapshot;
  const stale = !live && planned !== null && snapshot !== planned;
  useEffect(() => {
    if (!live && snapshot === null && planned !== null) refresh();
  }, [live, snapshot, planned, refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pane exists once a document is open
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDocument]);

  // The sheet and its numbers always come from the current plan.
  const total = planned?.length ?? 0;
  const index = Math.min(current, Math.max(0, total - 1));
  const sheet = planned?.[index];
  const cardCount = planned?.reduce((n, s) => n + s.placements.length, 0) ?? 0;

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
          aria-label={stripOpen ? "Hide sheet previews" : "Show sheet previews"}
          title={stripOpen ? "Hide sheet previews" : "Show sheet previews"}
          aria-expanded={stripOpen}
          onClick={() => setSectionOpen(STRIP_SECTION_ID, !stripOpen)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          {stripOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          aria-label="Previous sheet"
          disabled={index <= 0}
          onClick={() => setCurrent(index - 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="tabular-nums" data-testid="sheet-position">
          {total > 0 ? `Sheet ${index + 1} of ${total}` : "No sheets"}
        </span>
        <button
          type="button"
          aria-label="Next sheet"
          disabled={index >= total - 1}
          onClick={() => setCurrent(index + 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
        <span className="ml-auto text-[var(--muted)]" data-testid="sheet-summary">
          {total} sheet{total === 1 ? "" : "s"}, {cardCount} card{cardCount === 1 ? "" : "s"}
        </span>
        {!live && stripOpen && (
          <>
            {stale && <span className="text-[10px] font-semibold text-amber-400">Previews out of date</span>}
            <RefreshButton stale={stale} disabled={planned === null} onClick={refresh} />
          </>
        )}
      </div>
      {stripOpen && previews && previews.length > 0 && (
        <SheetStrip sheets={previews} current={index} onSelect={setCurrent} />
      )}
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]">
        {!hasDocument ? (
          <Message>Open a PDF to plan the sheets.</Message>
        ) : error ? (
          <Message tone="error">{error}</Message>
        ) : planned === null ? (
          <Message>Planning the sheets…</Message>
        ) : total === 0 ? (
          <Message>
            Nothing to print yet. Choose cards in the library and give them copies, or switch the plan back to all
            cards.
          </Message>
        ) : (
          content
        )}
        {!live && stripOpen && hasDocument && (
          <HintToast
            id="live-preview-manual"
            className="absolute bottom-3 left-3 z-30 w-[22rem] max-w-[70%]"
            action={{ label: "Open Preferences", onClick: () => useUiStore.getState().setPrefsOpen(true, "Preview") }}
          >
            Live preview is off, so the row of sheet previews above is not redrawn as you change the plan. Press the
            refresh button (top right) to update it. The large sheet always follows the plan. You can change this in
            Preferences &gt; Preview.
          </HintToast>
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
