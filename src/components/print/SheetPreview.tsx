import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CSS_PX_PER_PT } from "../../lib/coordinates";
import { formatError } from "../../lib/errors";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { RefreshButton } from "../editor/RefreshPreviewButton";
import { HintToast } from "../ui/HintToast";
import { WarningList } from "./FinishSections";
import { PlacedCard } from "./PlacedCard";
import { SheetOverlay } from "./SheetOverlay";
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
  const { t } = useTranslation();
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
  const duplex = planned?.some((s) => s.side === "back") ?? false;
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
        <SheetOverlay sheet={sheet} k={k} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="sheet-preview">
      {/* Wraps to a second line when the pane is narrow (longer texts, e.g. in Spanish) instead of clipping. */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-0.5">
        <button
          type="button"
          aria-label={stripOpen ? t("sheets.hide") : t("sheets.show")}
          title={stripOpen ? t("sheets.hide") : t("sheets.show")}
          aria-expanded={stripOpen}
          onClick={() => setSectionOpen(STRIP_SECTION_ID, !stripOpen)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          {stripOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button
          type="button"
          aria-label={t("sheets.previous")}
          disabled={index <= 0}
          onClick={() => setCurrent(index - 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="whitespace-nowrap tabular-nums" data-testid="sheet-position">
          {total > 0
            ? sheet?.side === "back"
              ? t("sheets.positionBack", { current: index + 1, total })
              : duplex
                ? t("sheets.positionFront", { current: index + 1, total })
                : t("sheets.position", { current: index + 1, total })
            : t("sheets.none")}
        </span>
        <button
          type="button"
          aria-label={t("sheets.next")}
          disabled={index >= total - 1}
          onClick={() => setCurrent(index + 1)}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
        <span className="ml-auto whitespace-nowrap text-[var(--muted)]" data-testid="sheet-summary">
          {t("sheets.summary", {
            sheets: t("sheets.sheetCount", { count: total }),
            pieces: t("sheets.pieceCount", { count: cardCount }),
          })}
        </span>
        {!live && stripOpen && (
          <>
            {stale && (
              <span className="whitespace-nowrap text-[10px] font-semibold text-amber-400">
                {t("sheets.outOfDate")}
              </span>
            )}
            <RefreshButton stale={stale} disabled={planned === null} onClick={refresh} />
          </>
        )}
      </div>
      {sheet?.warnings && sheet.warnings.length > 0 && (
        <div
          className="shrink-0 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1"
          data-testid="sheet-warnings"
        >
          <WarningList codes={sheet.warnings} />
        </div>
      )}
      {stripOpen && previews && previews.length > 0 && (
        <SheetStrip sheets={previews} current={index} onSelect={setCurrent} />
      )}
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]">
        {!hasDocument ? (
          <Message>{t("sheets.openPdf")}</Message>
        ) : error ? (
          <Message tone="error">{formatError(error)}</Message>
        ) : planned === null ? (
          <Message>{t("sheets.planning")}</Message>
        ) : total === 0 ? (
          <Message>{t("sheets.nothing")}</Message>
        ) : (
          content
        )}
        {!live && stripOpen && hasDocument && (
          <HintToast hint="live-preview-sheets" className="absolute bottom-3 left-3 z-30 w-[22rem] max-w-[70%]" />
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
