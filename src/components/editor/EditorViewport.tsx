import { useEffect, useRef, useState } from "react";
import {
  type NormalizedRect,
  type Point,
  pageScreenRect,
  pxPerPoint,
  rectToScreen,
  screenToDocument,
} from "../../lib/coordinates";
import { type Handle, moveRect, rectFromPoints, resizeRect } from "../../lib/selection";
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
  | { kind: "resize"; handle: Handle; start: Point; rect: NormalizedRect; fine?: boolean };

/** Press-and-hold on a handle for this long to open the magnifier. */
const HOLD_MS = 350;
/** Moving further than this (screen px) before the hold fires means a normal drag. */
const HOLD_TOLERANCE_PX = 4;

const MIN_CLICK_DRAG = 0.005; // normalized; smaller than this counts as a click

export function EditorViewport() {
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const error = useDocumentStore((s) => s.error);
  const loading = useDocumentStore((s) => s.loading);
  const viewport = useEditorStore((s) => s.viewport);
  const tool = useEditorStore((s) => s.tool);
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
    if (e.button !== 0 || !group) return; // a skipped page has no region to edit
    const doc = screenToDocument(p, ed.viewport, page);
    const hit = (e.target as SVGElement).dataset.hit;
    const current = getCurrentSelection();
    beginEdit(); // the whole drag is one undo step
    if (hit && current) {
      drag.current =
        hit === "body"
          ? { kind: "move", start: doc, rect: current }
          : { kind: "resize", handle: hit as Handle, start: doc, rect: current };
      if (hit !== "body") {
        const handle = hit as Handle;
        lastPointer.current = p;
        setLoupe({ handle, active: false });
        endHold();
        hold.current = {
          origin: p,
          timer: window.setTimeout(() => {
            hold.current = null;
            const d = drag.current;
            if (d?.kind !== "resize") return;
            const cur = useEditorStore.getState();
            const rect = getCurrentSelection();
            if (!rect) return;
            // Rebase the drag here so the handle doesn't jump, then slow it down.
            drag.current = {
              kind: "resize",
              handle: d.handle,
              fine: true,
              start: screenToDocument(lastPointer.current, cur.viewport, page),
              rect,
            };
            setLoupe({ handle: d.handle, active: true });
          }, HOLD_MS),
        };
      }
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
      const handle = hit && hit !== "body" ? (hit as Handle) : null;
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
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-red-400">{error}</p>
        ) : page && pageRect ? (
          <>
            {output ? (
              <OutputPreview screen={pageRect} k={pxPerPoint(viewport.zoom)} result={previewResult} />
            ) : (
              <PagePreview screen={pageRect} box={box} />
            )}
            <svg
              role="img"
              aria-label="Page canvas"
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
              {!output && selScreen && <SelectionRect screen={selScreen} movable={!panMode} />}
            </svg>
            {!output && loupe && selection && gridSpec && (
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
            {!output && skipped && (
              <p className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded bg-black/75 px-3 py-1.5 text-center text-[var(--muted)]">
                This page is skipped: it is left out of the export.
              </p>
            )}
            {output && <OutputNotice />}
          </>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-[var(--muted)]">
            {loading ? "Opening…" : "Open a PDF to get started (Ctrl/Cmd+O)"}
          </p>
        )}
      </div>
      {split && <div className="w-px shrink-0 bg-[var(--border)]" />}
      {split && <OutputPane />}
    </div>
  );
}
