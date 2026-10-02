import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import {
  pageScreenRect, rectToScreen, screenToDocument, type NormalizedRect, type Point,
} from "../../lib/coordinates";
import { moveRect, rectFromPoints, resizeRect, type Handle } from "../../lib/selection";
import { PagePreview } from "./PagePreview";
import { SelectionRect } from "./SelectionRect";

type Drag =
  | { kind: "pan"; start: Point; panX: number; panY: number }
  | { kind: "create"; anchor: Point }
  | { kind: "move"; start: Point; rect: NormalizedRect }
  | { kind: "resize"; handle: Handle; start: Point; rect: NormalizedRect };

const MIN_CLICK_DRAG = 0.005; // normalized; smaller than this counts as a click

export function EditorViewport() {
  const { pages, currentPage, path, error, loading } = useDocumentStore();
  const { viewport, tool, selection, fitMode } = useEditorStore();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  const page = pages[currentPage];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New document: forget the selection and fit.
  useEffect(() => useEditorStore.getState().reset(), [path]);

  // Keep the page fitted while in fit mode (resize, page change, new document).
  useEffect(() => {
    if (page && fitMode && box.width > 0) useEditorStore.getState().fit(box, page);
  }, [page, fitMode, box]);

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
      const pg = useDocumentStore.getState().pages[useDocumentStore.getState().currentPage];
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

  const panMode = tool === "pan" || spaceDown;

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
    } else {
      // Starting a new rectangle replaces the old one (so a bare click clears it).
      ed.setSelection(null);
      drag.current = { kind: "create", anchor: doc };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !page) return;
    const ed = useEditorStore.getState();
    const p = local(e);
    if (d.kind === "pan") {
      ed.setPan(d.panX + p.x - d.start.x, d.panY + p.y - d.start.y);
      return;
    }
    const doc = screenToDocument(p, ed.viewport, page);
    if (d.kind === "create") ed.setSelection(rectFromPoints(d.anchor, doc));
    else if (d.kind === "move") ed.setSelection(moveRect(d.rect, doc.x - d.start.x, doc.y - d.start.y));
    else ed.setSelection(resizeRect(d.rect, d.handle, doc.x - d.start.x, doc.y - d.start.y));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (d?.kind === "create") {
      const s = useEditorStore.getState().selection;
      // A plain click (no real drag) clears the selection.
      if (s && (s.width < MIN_CLICK_DRAG || s.height < MIN_CLICK_DRAG)) useEditorStore.getState().setSelection(null);
    }
  };

  const pageRect = page ? pageScreenRect(viewport, page) : null;
  const selScreen = page && selection ? rectToScreen(selection, viewport, page) : null;
  const cursor = panMode ? (panning ? "grabbing" : "grab") : "crosshair";

  return (
    <div ref={ref} data-viewport className="relative h-full w-full overflow-hidden bg-[#15161a]">
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center p-8 text-red-400">{error}</p>
      ) : page && pageRect ? (
        <>
          <PagePreview screen={pageRect} />
          <svg
            className="absolute inset-0 h-full w-full"
            style={{ cursor, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {selScreen && <SelectionRect screen={selScreen} movable={!panMode} />}
          </svg>
        </>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center text-[var(--muted)]">
          {loading ? "Opening…" : "Open a PDF to get started (Ctrl/Cmd+O)"}
        </p>
      )}
    </div>
  );
}
