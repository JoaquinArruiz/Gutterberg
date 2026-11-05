import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize, Tag, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { fitViewport, pxPerPoint } from "../../lib/coordinates";
import { formatError } from "../../lib/errors";
import { fillCss } from "../../lib/finish";
import { emitHintEvent } from "../../lib/hint-events";
import type { PageSize } from "../../lib/tauri";
import { mmToPt } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { outputPage, useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { SHEET_PAD, sheetViewport, useSheetViewStore } from "../../stores/sheet-view-store";
import { RefreshButton } from "../editor/RefreshPreviewButton";
import { HintToast } from "../ui/HintToast";
import { WarningList } from "./FinishSections";
import { PlacedCard } from "./PlacedCard";
import { EdgeFills, SheetOverlay } from "./SheetOverlay";
import { SheetReferences } from "./SheetReferences";
import { SheetStrip } from "./SheetStrip";

/** Remembered like the inspector's sections: the strip of sheet previews is open unless the user hid it. */
export const STRIP_SECTION_ID = "print.sheet-strip";

/**
 * The sheets the plan produces: one sheet large, and a row of small previews of all of them
 * (hideable). The large sheet always follows the plan: it is redrawn when copies change and when
 * another sheet is chosen. Only the row of previews obeys Live Preview: with it off, the row shows
 * the sheets as of the last refresh. The large sheet can be zoomed (the buttons, +, - and 0, Ctrl/Cmd+wheel at the
 * cursor) and moved (a drag, or the wheel); 0 fits it to the pane again.
 */
export function SheetPreview() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  const firstPage = useDocumentStore((s) => s.documents[0]?.pages[0] ?? null);
  const live = useLayoutStore((s) => s.live);
  const planned = usePrintStore((s) => s.sheets);
  const snapshot = usePrintStore((s) => s.sheetsSnapshot);
  const error = usePrintStore((s) => s.sheetsError);
  const current = usePrintStore((s) => s.currentSheet);
  const setCurrent = usePrintStore((s) => s.setCurrentSheet);
  const refresh = usePrintStore((s) => s.updateSheetsPreview);
  const stripOpen = usePreferencesStore((s) => s.prefs.inspector.sections[STRIP_SECTION_ID] ?? true);
  const setSectionOpen = usePreferencesStore((s) => s.setSectionOpen);
  const showReferences = usePreferencesStore((s) => s.prefs.print.showReferences);
  const setShowReferences = usePreferencesStore((s) => s.setShowReferences);
  const view = useSheetViewStore((s) => s.view);
  const setFrame = useSheetViewStore((s) => s.setFrame);
  const zoomIn = useSheetViewStore((s) => s.zoomIn);
  const zoomOut = useSheetViewStore((s) => s.zoomOut);
  const fit = useSheetViewStore((s) => s.fit);
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

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

  // What the zoom buttons, keys and status bar work on: the pane and the sheet in it.
  const sheetPage = sheet?.page ?? null;
  useEffect(() => setFrame(box, sheetPage), [box, sheetPage, setFrame]);

  // The scale (screen px per point) of a sheet of `page` in the pane, and where its top-left corner goes. The
  // blank sheet is always fitted; the plan's sheets follow the zoom.
  const placeSheet = (page: PageSize, zoomed = true) => {
    const vp = zoomed ? sheetViewport(view, box, page) : fitViewport(box, page, SHEET_PAD);
    const k = pxPerPoint(vp.zoom);
    const style = { left: vp.panX, top: vp.panY, width: page.width_pt * k, height: page.height_pt * k };
    return { k, style };
  };

  // Ctrl/Cmd+wheel (and a trackpad pinch) zooms at the cursor, the wheel alone moves the sheet, as on the Source
  // tab. A non-passive listener, to keep the web view from zooming or scrolling itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pane exists once a document is open
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = useSheetViewStore.getState();
      if (!v.page) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        v.zoomBy(Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else v.panBy(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasDocument]);

  // A drag with the left or middle button moves the sheet; the right button stays the piece peek.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.button !== 0 && e.button !== 1) || !sheet) return;
    // Help tips and messages in the pane keep their own clicks.
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && !target.closest("[data-testid=sheet-page]")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    useSheetViewStore.getState().panBy(e.clientX - p.x, e.clientY - p.y);
    pan.current = { ...p, x: e.clientX, y: e.clientY };
  };
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pan.current?.id !== e.pointerId) return;
    pan.current = null;
    setPanning(false);
  };

  let content: React.ReactNode = null;
  if (sheet && box.width > 0) {
    const { k, style } = placeSheet(sheet.page);
    content = (
      <div
        className="absolute shadow-lg shadow-black/50"
        style={{ ...style, background: fillCss(sheet.background?.sheet) }}
        data-testid="sheet-page"
      >
        <EdgeFills sheet={sheet} k={k} />
        {sheet.placements.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a card can appear many times on a sheet; its slot is its identity
          <PlacedCard key={i} p={p} k={k} fill={fillCss(sheet.background?.pieces)} />
        ))}
        <SheetOverlay sheet={sheet} k={k} />
        {showReferences && <SheetReferences sheet={sheet} k={k} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="sheet-preview" data-hint-target="sheet-preview">
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
        <button
          type="button"
          aria-label={t("sheets.references")}
          title={`${t("sheets.references")}. ${t("sheets.referencesHint")}`}
          aria-pressed={showReferences}
          data-hint-target="references-button"
          onClick={() => {
            setShowReferences(!showReferences);
            if (!showReferences) emitHintEvent("references-shown");
          }}
          className={`rounded p-1 hover:bg-[var(--hover)] ${showReferences ? "bg-[var(--accent)]/25 text-[var(--accent)]" : ""}`}
        >
          <Tag size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-[var(--border)]" />
        <button
          type="button"
          aria-label={t("sheets.zoomOut")}
          title={t("sheets.zoomOut")}
          disabled={!sheet}
          onClick={zoomOut}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          aria-label={t("sheets.zoomIn")}
          title={t("sheets.zoomIn")}
          disabled={!sheet}
          onClick={zoomIn}
          className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          aria-label={t("sheets.fit")}
          title={t("sheets.fit")}
          aria-pressed={view === null}
          disabled={!sheet}
          onClick={fit}
          className={`rounded p-1 hover:bg-[var(--hover)] disabled:opacity-40 ${view === null && sheet ? "bg-[var(--accent)]/25 text-[var(--accent)]" : ""}`}
        >
          <Maximize size={14} />
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
      <div
        ref={ref}
        data-testid="sheet-pane"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-[var(--canvas)] ${sheet ? (panning ? "cursor-grabbing" : "cursor-grab") : ""}`}
      >
        {!hasDocument ? (
          <Message>{t("sheets.openPdf")}</Message>
        ) : error ? (
          <Message tone="error">{formatError(error)}</Message>
        ) : planned === null ? (
          <Message>{t("sheets.planning")}</Message>
        ) : total === 0 ? (
          <>
            {box.width > 0 && <BlankSheet place={placeSheet} firstPage={firstPage} />}
            <Message>{t("sheets.nothing")}</Message>
          </>
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

/**
 * The sheet before anything is on it: white, of the size the plan will use, with its margins as a faint dashed
 * line. "Same as source" (and Auto-fit, which has no size until there are pieces) shows the first page of the
 * first document, or A4 when there is none.
 */
function BlankSheet({
  place,
  firstPage,
}: {
  place: (page: PageSize, zoomed?: boolean) => { k: number; style: React.CSSProperties };
  firstPage: PageSize | null;
}) {
  const output = useLayoutStore(
    useShallow((s) => ({
      pageMode: s.pageMode,
      orientation: s.orientation,
      customWidthMm: s.customWidthMm,
      customHeightMm: s.customHeightMm,
      gapXMm: s.gapXMm,
      gapYMm: s.gapYMm,
      margins: s.margins,
    })),
  );
  const page = outputPage(output) ?? firstPage ?? { width_pt: mmToPt(210), height_pt: mmToPt(297) };
  const { k, style } = place(page, false);
  const m = output.margins;
  return (
    <div className="absolute bg-white shadow-lg shadow-black/50" style={style} data-testid="blank-sheet">
      <div
        className="absolute border border-dashed border-black/15"
        style={{
          left: mmToPt(m.left) * k,
          top: mmToPt(m.top) * k,
          right: mmToPt(m.right) * k,
          bottom: mmToPt(m.bottom) * k,
        }}
      />
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
