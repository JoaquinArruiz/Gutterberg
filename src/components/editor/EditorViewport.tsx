import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrientedRect } from "../../lib/card";
import {
  type NormalizedRect,
  type Point,
  pageScreenRect,
  pxPerPoint,
  rectToScreen,
  screenToDocument,
} from "../../lib/coordinates";
import { drawCard, isTooSmall, moveCard, resizeCard, rotateCardTo } from "../../lib/freeform";
import { HANDLES, type Handle, moveRect, rectFromPoints, resizeRect } from "../../lib/selection";
import type { PageSize } from "../../lib/tauri";
import { usePreviewResult } from "../../lib/view-page";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import {
  beginEdit,
  endEdit,
  getCurrentSelection,
  setCurrentSelection,
  useCurrentGridGroup,
  useCurrentGroup,
  useLayoutStore,
} from "../../stores/layout-store";
import { HintToast } from "../ui/HintToast";
import { FreeformOverlay } from "./FreeformOverlay";
import { GridOverlay } from "./GridOverlay";
import { MAG, Magnifier } from "./Magnifier";
import { OutputNotice } from "./OutputNotice";
import { OutputPane } from "./OutputPane";
import { OutputPreview } from "./OutputPreview";
import { PagePreview } from "./PagePreview";
import { SelectionRect } from "./SelectionRect";

type Drag =
  | { kind: "pan"; start: Point; panX: number; panY: number }
  | { kind: "create"; anchor: Point }
  | { kind: "move"; start: Point; rect: NormalizedRect }
  | { kind: "resize"; handle: Handle; start: Point; rect: NormalizedRect; fine?: boolean }
  // The card tool: `index` is null until a drawn card is big enough to exist.
  | { kind: "card-create"; anchor: Point; index: number | null }
  | { kind: "card-move"; index: number; start: Point; rect: OrientedRect }
  | { kind: "card-resize"; index: number; handle: Handle; start: Point; rect: OrientedRect; fine?: boolean }
  | { kind: "card-rotate"; index: number; rect: OrientedRect };

const NO_CARDS: OrientedRect[] = [];
const isHandle = (hit: string | undefined): hit is Handle => HANDLES.includes(hit as Handle);

/** Press-and-hold on a handle for this long to open the magnifier. */
const HOLD_MS = 350;
/** Moving further than this (screen px) before the hold fires means a normal drag. */
const HOLD_TOLERANCE_PX = 4;

const MIN_CLICK_DRAG = 0.005; // normalized; smaller than this counts as a click

export function EditorViewport() {
  const { t } = useTranslation();
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const loading = useDocumentStore((s) => s.loading);
  const viewport = useEditorStore((s) => s.viewport);
  const tool = useEditorStore((s) => s.tool);
  const selectedCard = useEditorStore((s) => s.selectedCard);
  const freeform = useLayoutStore((s) => s.freeform[currentPage]) ?? NO_CARDS;
  const group = useCurrentGridGroup();
  const skipped = useCurrentGroup()?.kind === "skip";
  const selection = group?.selection ?? null;
  const fitMode = useEditorStore((s) => s.fitMode);
  const viewMode = useEditorStore((s) => s.viewMode);
  const previewResult = usePreviewResult();
  const gridSpec = group && {
    rows: group.grid.rows,
    columns: group.grid.columns,
    gapXMm: group.grid.sourceGapXMm,
    gapYMm: group.grid.sourceGapYMm,
  };
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  // Magnifier: `pending` while a handle is held (raster prefetching), `active` once the hold fired.
  const [loupe, setLoupe] = useState<{ handle: Handle; active: boolean } | null>(null);
  const hold = useRef<{ timer: number; origin: Point } | null>(null);
  const lastPointer = useRef<Point>({ x: 0, y: 0 });
  const endHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: endHold only touches a ref; cleanup on unmount
  useEffect(() => endHold, []);

  const page = pages[currentPage];
  const output = viewMode === "output";
  // The page the viewport pans/zooms: the (possibly differently sized) output page in Output view.
  const viewPage = output ? (previewResult?.output_page ?? page) : page;
  // Output view has no refresh button: showing it (re)generates the manual preview. Split keeps its button.
  const live = useLayoutStore((s) => s.live);
  const result = useLayoutStore((s) => s.result);
  const snapshot = useLayoutStore((s) => s.snapshot);
  useEffect(() => {
    if (output && !live) useLayoutStore.getState().updatePreview(); // entering Output
  }, [output, live]);
  useEffect(() => {
    // The layout may arrive after entering Output (selection still computing).
    if (output && !live && result && !snapshot) useLayoutStore.getState().updatePreview();
  }, [output, live, result, snapshot]);
  const viewPageRef = useRef(viewPage);
  viewPageRef.current = viewPage;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the page fitted while in fit mode (resize, page change, new document).
  useEffect(() => {
    if (viewPage && fitMode && box.width > 0) useEditorStore.getState().fit(box, viewPage);
  }, [viewPage, fitMode, box]);

  // Space = temporary pan.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Wheel: ctrl/cmd (and trackpad pinch) zooms at the cursor, otherwise pans.
  // Needs a non-passive listener to preventDefault.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const pg = viewPageRef.current;
      if (!pg) return;
      e.preventDefault();
      const s = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        s.zoomBy(Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top }, pg);
      } else {
        s.panBy(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const panMode = output || tool === "pan" || spaceDown;
  // The card tool edits freeform cards; skipped pages are left out of the export, so they take none.
  const cardTool = tool === "card" && !output && !skipped && !panMode;
  const picked = selectedCard?.page === currentPage ? selectedCard.index : null;
  const pickedCard = picked === null ? null : (freeform[picked] ?? null);

  /** A handle was pressed: prefetch the magnifier, and open it if the pointer stays put for a moment. */
  const startHold = (handle: Handle, p: Point, pg: PageSize) => {
    lastPointer.current = p;
    setLoupe({ handle, active: false });
    endHold();
    hold.current = {
      origin: p,
      timer: window.setTimeout(() => {
        hold.current = null;
        const d = drag.current;
        if (d?.kind !== "resize" && d?.kind !== "card-resize") return;
        const cur = useEditorStore.getState();
        const start = screenToDocument(lastPointer.current, cur.viewport, pg);
        // Rebase the drag here so the handle doesn't jump, then slow it down.
        if (d.kind === "resize") {
          const rect = getCurrentSelection();
          if (!rect) return;
          drag.current = { kind: "resize", handle: d.handle, fine: true, start, rect };
        } else {
          const rect = useLayoutStore.getState().freeform[currentPage]?.[d.index];
          if (!rect) return;
          drag.current = { kind: "card-resize", index: d.index, handle: d.handle, fine: true, start, rect };
        }
        setLoupe({ handle: d.handle, active: true });
      }, HOLD_MS),
    };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!page) return;
    // Stop the webview from starting a native text/image selection (WebKit paints it
    // blue over the page while dragging). This also skips the focus change, so blur
    // the focused field by hand: sidebar inputs commit on blur.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const p = local(e);
    const ed = useEditorStore.getState();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (panMode || e.button === 1) {
      drag.current = { kind: "pan", start: p, panX: ed.viewport.panX, panY: ed.viewport.panY };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const doc = screenToDocument(p, ed.viewport, page);
    const hit = (e.target as SVGElement).dataset.hit;
    if (cardTool) {
      const L = useLayoutStore.getState();
      const own = L.freeform[currentPage] ?? NO_CARDS;
      const index = Number((e.target as SVGElement).dataset.card);
      const card = own[index];
      const select = (i: number | null) => ed.setSelectedCard(i === null ? null : { page: currentPage, index: i });
      beginEdit(); // the whole drag is one undo step
      if (card && hit === "rotate") {
        select(index);
        drag.current = { kind: "card-rotate", index, rect: card };
      } else if (card && isHandle(hit)) {
        select(index);
        drag.current = { kind: "card-resize", index, handle: hit, start: doc, rect: card };
        startHold(hit, p, page);
      } else if (card && hit === "card") {
        select(index);
        drag.current = { kind: "card-move", index, start: doc, rect: card };
      } else {
        // Dragging on empty page draws a new card; a bare click only drops the selection.
        select(null);
        drag.current = { kind: "card-create", anchor: doc, index: null };
      }
      return;
    }
    if (!group) return; // a skipped page has no region to edit
    const current = getCurrentSelection();
    beginEdit(); // the whole drag is one undo step
    if (hit && current) {
      drag.current =
        hit === "body"
          ? { kind: "move", start: doc, rect: current }
          : { kind: "resize", handle: hit as Handle, start: doc, rect: current };
      if (hit !== "body") startHold(hit as Handle, p, page);
    } else {
      // Starting a new rectangle replaces the old one (so a bare click clears it).
      setCurrentSelection(null);
      drag.current = { kind: "create", anchor: doc };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d && page && !panMode) {
      // Hovering a handle starts rendering the magnifier crop, so it is ready when the hold fires.
      const hit = (e.target as SVGElement).dataset.hit;
      const handle = isHandle(hit) ? hit : null;
      setLoupe((cur) => (cur?.handle === handle ? cur : handle ? { handle, active: false } : null));
    }
    if (!d || !page) return;
    const ed = useEditorStore.getState();
    const p = local(e);
    lastPointer.current = p;
    if (hold.current && Math.hypot(p.x - hold.current.origin.x, p.y - hold.current.origin.y) > HOLD_TOLERANCE_PX) {
      endHold();
      setLoupe(null);
    }
    if (d.kind === "pan") {
      ed.setPan(d.panX + p.x - d.start.x, d.panY + p.y - d.start.y);
      return;
    }
    const doc = screenToDocument(p, ed.viewport, page);
    if (d.kind === "card-create") {
      const L = useLayoutStore.getState();
      const card = drawCard(d.anchor, doc, page);
      if (d.index !== null) L.updateFreeformCard(currentPage, d.index, card);
      else if (!isTooSmall(card, page)) {
        d.index = L.addFreeformCard(currentPage, card);
        ed.setSelectedCard({ page: currentPage, index: d.index });
      }
      return;
    }
    if (d.kind === "card-move" || d.kind === "card-resize" || d.kind === "card-rotate") {
      const L = useLayoutStore.getState();
      if (d.kind === "card-move")
        L.updateFreeformCard(currentPage, d.index, moveCard(d.rect, doc.x - d.start.x, doc.y - d.start.y));
      else if (d.kind === "card-rotate")
        L.updateFreeformCard(currentPage, d.index, rotateCardTo(d.rect, doc, page, e.shiftKey));
      else {
        const k = d.fine ? 1 / MAG : 1;
        L.updateFreeformCard(
          currentPage,
          d.index,
          resizeCard(d.rect, d.handle, (doc.x - d.start.x) * k, (doc.y - d.start.y) * k, page),
        );
      }
      return;
    }
    if (d.kind === "create") setCurrentSelection(rectFromPoints(d.anchor, doc));
    else if (d.kind === "move") setCurrentSelection(moveRect(d.rect, doc.x - d.start.x, doc.y - d.start.y));
    else {
      const k = d.fine ? 1 / MAG : 1;
      setCurrentSelection(resizeRect(d.rect, d.handle, (doc.x - d.start.x) * k, (doc.y - d.start.y) * k));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    endHold();
    setLoupe(null);
    if (d?.kind === "card-create" && d.index !== null && page) {
      // Shrunk back to nothing before letting go: not a card after all.
      const card = useLayoutStore.getState().freeform[currentPage]?.[d.index];
      if (card && isTooSmall(card, page)) {
        useLayoutStore.getState().deleteFreeformCard(currentPage, d.index);
        useEditorStore.getState().setSelectedCard(null);
      }
    }
    if (d?.kind === "create") {
      const s = getCurrentSelection();
      // A plain click (no real drag) clears the selection.
      if (s && (s.width < MIN_CLICK_DRAG || s.height < MIN_CLICK_DRAG)) setCurrentSelection(null);
    }
    endEdit();
  };

  const pageRect = viewPage ? pageScreenRect(viewport, viewPage) : null;
  const selScreen = page && selection ? rectToScreen(selection, viewport, page) : null;
  const cursor = panMode ? (panning ? "grabbing" : "grab") : "crosshair";

  const split = viewMode === "split" && !!page;
  return (
    <div className="flex h-full w-full">
      <div
        ref={ref}
        data-viewport
        data-hint-target="page-canvas"
        className="relative h-full min-w-0 flex-1 overflow-hidden bg-[var(--canvas)]"
      >
        {/* Where tour tips sit when they point at the whole canvas: inside it, above this spot. */}
        <span
          aria-hidden
          data-hint-target="page-canvas-tip"
          className="pointer-events-none absolute bottom-6 left-1/2 size-px"
        />
        {page && pageRect ? (
          <>
            {output ? (
              <OutputPreview screen={pageRect} k={pxPerPoint(viewport.zoom)} result={previewResult} />
            ) : (
              <PagePreview screen={pageRect} box={box} />
            )}
            <svg
              role="img"
              aria-label={t("viewport.pageCanvas")}
              className="absolute inset-0 h-full w-full select-none"
              style={{ cursor, touchAction: "none", WebkitUserSelect: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => !drag.current && setLoupe(null)}
            >
              {!output && selection && gridSpec && (
                <GridOverlay selection={selection} grid={gridSpec} viewport={viewport} page={page} />
              )}
              {!output && selScreen && (
                // In the card tool the grid region is only a backdrop: it must not catch the pointer.
                <g pointerEvents={tool === "card" ? "none" : undefined}>
                  <SelectionRect screen={selScreen} movable={!panMode && tool !== "card"} />
                </g>
              )}
              {!output && freeform.length > 0 && (
                <FreeformOverlay
                  cards={freeform}
                  selected={picked}
                  viewport={viewport}
                  page={page}
                  interactive={cardTool}
                />
              )}
            </svg>
            {!output && loupe && !cardTool && selection && gridSpec && (
              <Magnifier
                handle={loupe.handle}
                active={loupe.active}
                selection={selection}
                page={page}
                pageRect={pageRect}
                box={box}
                grid={gridSpec}
              />
            )}
            {!output && loupe && cardTool && pickedCard && (
              <Magnifier
                handle={loupe.handle}
                active={loupe.active}
                card={pickedCard}
                page={page}
                pageRect={pageRect}
                box={box}
              />
            )}
            {cardTool && (
              <HintToast
                hint="freeform-tool"
                className="absolute left-1/2 top-3 z-30 w-[22rem] max-w-[90%] -translate-x-1/2"
              />
            )}
            {!output && skipped && (
              <p className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded bg-black/75 px-3 py-1.5 text-center text-[var(--muted)]">
                {t("viewport.pageSkipped")}
              </p>
            )}
            {output && <OutputNotice />}
          </>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-[var(--muted)]">
            {loading ? t("viewport.opening") : t("viewport.openHint")}
          </p>
        )}
      </div>
      {split && <div className="w-px shrink-0 bg-[var(--border)]" />}
      {split && <OutputPane />}
    </div>
  );
}
