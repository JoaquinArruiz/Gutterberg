import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import {
  pageScreenRect, rectToScreen, screenToDocument, type NormalizedRect, type Point,
} from "../../lib/coordinates";
import { moveRect, rectFromPoints, resizeRect, type Handle } from "../../lib/selection";
import { PagePreview } from "./PagePreview";
import { SelectionRect } from "./SelectionRect";
import { GridOverlay } from "./GridOverlay";
import { OutputPreview } from "./OutputPreview";
import { OutputPane } from "./OutputPane";
import { Magnifier, MAG } from "./Magnifier";
import { OutputNotice } from "./OutputNotice";
import { usePreviewResult } from "../../lib/view-page";
import { pxPerPoint } from "../../lib/coordinates";
import { useLayoutStore } from "../../stores/layout-store";
import { startSession } from "../../lib/workspace";

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
  const { pages, currentPage, path, error, loading } = useDocumentStore();
  const { viewport, tool, selection, fitMode, viewMode } = useEditorStore();
  const previewResult = usePreviewResult();
  const rows = useLayoutStore((s) => s.rows);
  const sourceGapXMm = useLayoutStore((s) => s.sourceGapXMm);
  const sourceGapYMm = useLayoutStore((s) => s.sourceGapYMm);
  const columns = useLayoutStore((s) => s.columns);
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

  // New document: forget the selection and fit.
  useEffect(() => {
    useEditorStore.getState().reset();
    useLayoutStore.getState().clearSnapshot();
    startSession(); // new document = new session: workspace and Live Preview start from preferences
  }, [path]);

  // Keep the page fitted while in fit mode (resize, page change, new document).
  useEffect(() => {
    if (viewPage && fitMode && box.width > 0) useEditorStore.getState().fit(box, viewPage);
  }, [viewPage, fitMode, box]);

  // Space = temporary pan.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => e.code === "Space" && !typing(e) && (e.preventDefault(), setSpaceDown(true));
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
    if (hit && ed.selection) {
      drag.current =
        hit === "body"
          ? { kind: "move", start: doc, rect: ed.selection }
          : { kind: "resize", handle: hit as Handle, start: doc, rect: ed.selection };
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
            if (!cur.selection) return;
            // Rebase the drag here so the handle doesn't jump, then slow it down.
            drag.current = {
              kind: "resize", handle: d.handle, fine: true,
              start: screenToDocument(lastPointer.current, cur.viewport, page),
              rect: cur.selection,
            };
            setLoupe({ handle: d.handle, active: true });
          }, HOLD_MS),
        };
      }
    } else {
      // Starting a new rectangle replaces the old one (so a bare click clears it).
      ed.setSelection(null);
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
    if (d.kind === "create") ed.setSelection(rectFromPoints(d.anchor, doc));
    else if (d.kind === "move") ed.setSelection(moveRect(d.rect, doc.x - d.start.x, doc.y - d.start.y));
    else {
      const k = d.fine ? 1 / MAG : 1;
      ed.setSelection(resizeRect(d.rect, d.handle, (doc.x - d.start.x) * k, (doc.y - d.start.y) * k));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    endHold();
    setLoupe(null);
    if (d?.kind === "create") {
      const s = useEditorStore.getState().selection;
      // A plain click (no real drag) clears the selection.
      if (s && (s.width < MIN_CLICK_DRAG || s.height < MIN_CLICK_DRAG)) useEditorStore.getState().setSelection(null);
    }
  };

  const pageRect = viewPage ? pageScreenRect(viewport, viewPage) : null;
  const selScreen = page && selection ? rectToScreen(selection, viewport, page) : null;
  const cursor = panMode ? (panning ? "grabbing" : "grab") : "crosshair";

  const split = viewMode === "split" && !!page;
  return (
    <div className="flex h-full w-full">
    <div ref={ref} data-viewport className="relative h-full min-w-0 flex-1 overflow-hidden bg-[var(--canvas)]">
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center p-8 text-red-400">{error}</p>
      ) : page && pageRect ? (
        <>
          {output ? (
            <OutputPreview screen={pageRect} k={pxPerPoint(viewport.zoom)} result={previewResult} />
          ) : (
            <PagePreview screen={pageRect} />
          )}
          <svg
            className="absolute inset-0 h-full w-full"
            style={{ cursor, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => !drag.current && setLoupe(null)}
          >
            {!output && selection && <GridOverlay selection={selection} grid={{ rows, columns, gapXMm: sourceGapXMm, gapYMm: sourceGapYMm }} viewport={viewport} page={page} />}
            {!output && selScreen && <SelectionRect screen={selScreen} movable={!panMode} />}
          </svg>
          {!output && loupe && selection && (
            <Magnifier
              handle={loupe.handle} active={loupe.active} selection={selection} page={page} pageRect={pageRect}
              box={box} grid={{ rows, columns, gapXMm: sourceGapXMm, gapYMm: sourceGapYMm }}
            />
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
