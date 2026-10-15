import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OrientedRect } from "../../lib/card";
import {
  documentToScreen,
  edgesToNormalized,
  guidesToNormalized,
  type NormalizedRect,
  normalizedToGuide,
  type Point,
  pageScreenRect,
  pxPerPoint,
  rectToScreen,
  screenToDocument,
} from "../../lib/coordinates";
import { pageEdges } from "../../lib/edges-api";
import { copyPieces, movePieces, pickedOnPage } from "../../lib/editor-actions";
import { drawCard, isTooSmall, resizeCard, rotateCardTo } from "../../lib/freeform";
import {
  dropGuide,
  type GuideAxis,
  guideFrom,
  NO_GUIDE_SET,
  overRuler,
  type RulerSide,
  rulerOf,
} from "../../lib/guides";
import { emitHintEvent } from "../../lib/hint-events";
import { HANDLES, type Handle, moveRect, rectFromPoints, resizeRect } from "../../lib/selection";
import {
  cardBox,
  type EdgeLines,
  edgeTargets,
  FREE,
  type Guides,
  joinLines,
  NO_EDGES,
  NO_GUIDES,
  RELEASE_PX,
  rectLines,
  type SnapLines,
  type Stick,
  snapTargets,
  snapTolerance,
  stickyOffset,
} from "../../lib/snap";
import type { PageSize } from "../../lib/tauri";
import { mmToPt } from "../../lib/units";
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
import { usePreferencesStore } from "../../stores/preferences-store";
import { HintToast } from "../ui/HintToast";
import { DetectDraftBar, DetectOverlay } from "./DetectDraft";
import { FreeformOverlay } from "./FreeformOverlay";
import { GridOverlay } from "./GridOverlay";
import { type GuideDrag, GuideLines } from "./GuideLines";
import { MAG, Magnifier } from "./Magnifier";
import { OutputNotice } from "./OutputNotice";
import { OutputPane } from "./OutputPane";
import { OutputPreview } from "./OutputPreview";
import { PagePreview } from "./PagePreview";
import { Ruler, RulerCorner, type RulerHandle } from "./Rulers";
import { SelectionRect } from "./SelectionRect";
import { StickyEdgesTip } from "./StickyEdgesTip";

type Drag =
  | { kind: "pan"; start: Point; panX: number; panY: number }
  | { kind: "create"; anchor: Point }
  | { kind: "move"; start: Point; rect: NormalizedRect }
  | { kind: "resize"; handle: Handle; start: Point; rect: NormalizedRect; fine?: boolean }
  // The card tool: `index` is null until a drawn card is big enough to exist.
  | { kind: "card-create"; anchor: Point; index: number | null }
  // Moving one piece or several picked together; `rects` are where they were when the drag started.
  | { kind: "card-move"; indices: number[]; start: Point; rects: OrientedRect[] }
  | { kind: "card-resize"; index: number; handle: Handle; start: Point; rect: OrientedRect; fine?: boolean }
  | { kind: "card-rotate"; index: number; rect: OrientedRect }
  // A guide dragged out of a ruler (`index` null) or grabbed on the page.
  | { kind: "guide"; axis: GuideAxis; index: number | null };

const NO_CARDS: OrientedRect[] = [];
const isHandle = (hit: string | undefined): hit is Handle => HANDLES.includes(hit as Handle);

/** Press-and-hold on a handle for this long to open the magnifier. */
const HOLD_MS = 350;
/** Moving further than this (screen px) before the hold fires means a normal drag. */
const HOLD_TOLERANCE_PX = 4;

const MIN_CLICK_DRAG = 0.005; // normalized; smaller than this counts as a click

/** The edges of `r` a resize handle moves, for snapping just those. */
const movedEdges = (r: NormalizedRect, handle: Handle): SnapLines => ({
  xs: handle.includes("w") ? [r.x] : handle.includes("e") ? [r.x + r.width] : [],
  ys: handle.includes("n") ? [r.y] : handle.includes("s") ? [r.y + r.height] : [],
});

/** The box around several rectangles. */
function union(rects: NormalizedRect[]): NormalizedRect {
  const [x, y] = [Math.min(...rects.map((r) => r.x)), Math.min(...rects.map((r) => r.y))];
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function EditorViewport() {
  const { t } = useTranslation();
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const loading = useDocumentStore((s) => s.loading);
  const viewport = useEditorStore((s) => s.viewport);
  const tool = useEditorStore((s) => s.tool);
  const selectedCard = useEditorStore((s) => s.selectedCard);
  const pickedCards = useEditorStore((s) => s.pickedCards);
  const pickedRegion = useEditorStore((s) => s.pickedRegion);
  const freeform = useLayoutStore((s) => s.freeform[currentPage]) ?? NO_CARDS;
  const group = useCurrentGridGroup();
  const skipped = useCurrentGroup()?.kind === "skip";
  const selection = group?.selection ?? null;
  // A grid and freeform pieces on one page: the tip says that is allowed and how to get several sizes.
  const hasGridAndPieces = selection !== null && freeform.length > 0;
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
  // The lines a drag snapped to, shown while it holds.
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  // What the drag's snapping holds on to between two moves (sticky snapping).
  const stick = useRef<Stick>(FREE);
  // The straight edges in this page's artwork, normalized, while sticky edges are on.
  const edges = useRef<EdgeLines>(NO_EDGES);
  // The rulers' pointer marks, moved on every pointer move without a render.
  const rulerX = useRef<RulerHandle>(null);
  const rulerY = useRef<RulerHandle>(null);
  // The guide being dragged, drawn where the pointer is; the ref is what the release reads.
  const [guideDrag, setGuideDrag] = useState<GuideDrag | null>(null);
  const guideDragRef = useRef<GuideDrag | null>(null);
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
  const rulers = usePreferencesStore((s) => s.prefs.editor.rulers) && !!page && !output;
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

  // The page's edges, asked for once per page (the answer is kept for the session) while sticky edges are on.
  const activeId = useDocumentStore((s) => s.activeId);
  const snapEdges = usePreferencesStore((s) => s.prefs.editor.snapEdges);
  const rulerGuides = useEditorStore((s) => s.guides[activeId]) ?? NO_GUIDE_SET;
  useEffect(() => {
    edges.current = NO_EDGES;
    if (!snapEdges || !page) return;
    let current = true;
    pageEdges(activeId, currentPage)
      .then((e) => {
        if (current) edges.current = edgesToNormalized(e, page);
      })
      .catch(() => {}); // no edges: the rest of snapping still works
    return () => {
      current = false;
    };
  }, [activeId, currentPage, page, snapEdges]);

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
  // Every picked piece of this page; the handles and the magnifier are for one piece at a time.
  const pickedHere = selectedCard?.page === currentPage ? pickedCards : [];
  const single = pickedHere.length <= 1;
  const pickedCard = picked === null || !single ? null : (freeform[picked] ?? null);

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

  /** Follows a guide drag to `p` (canvas px). */
  const trackGuide = (axis: GuideAxis, index: number | null, p: Point) => {
    if (!page) return;
    const doc = screenToDocument(p, useEditorStore.getState().viewport, page);
    const g: GuideDrag = {
      axis,
      index,
      pt: normalizedToGuide(axis === "x" ? doc.x : doc.y, axis, page),
      // Dropped back on the ruler it comes from, it is deleted.
      onRuler: overRuler(rulerOf(axis, usePreferencesStore.getState().prefs.editor.invertRulers), p),
    };
    guideDragRef.current = g;
    setGuideDrag(g);
  };

  /**
   * Pressing on a ruler drags out a new guide: a horizontal one from the top ruler and a vertical one from the left,
   * or the other way round with "Invert rulers".
   */
  const onRulerDown = (ruler: RulerSide) => (e: React.PointerEvent<SVGSVGElement>) => {
    if (!page || e.button !== 0) return;
    const axis = guideFrom(ruler, usePreferencesStore.getState().prefs.editor.invertRulers);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: "guide", axis, index: null };
    trackGuide(axis, null, local(e));
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
    stick.current = FREE;
    if (panMode || e.button === 1) {
      drag.current = { kind: "pan", start: p, panX: ed.viewport.panX, panY: ed.viewport.panY };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const doc = screenToDocument(p, ed.viewport, page);
    const hit = (e.target as SVGElement).dataset.hit;
    if (hit === "guide") {
      // A guide is grabbed with the Grid region or Piece tool: drag it, or back onto its ruler to delete it.
      const data = (e.target as SVGElement).dataset;
      const axis = data.axis === "x" ? "x" : "y";
      drag.current = { kind: "guide", axis, index: Number(data.index) };
      trackGuide(axis, Number(data.index), p);
      return;
    }
    if (cardTool) {
      const L = useLayoutStore.getState();
      const own = L.freeform[currentPage] ?? NO_CARDS;
      const index = Number((e.target as SVGElement).dataset.card);
      const card = own[index];
      const select = (i: number | null) => ed.setSelectedCard(i === null ? null : { page: currentPage, index: i });
      // Shift adds a piece to the picked ones (or takes it out). Ctrl/Cmd is left for dragging without snapping.
      const adding = e.shiftKey;
      beginEdit(); // the whole drag is one undo step
      if (card && hit === "rotate") {
        select(index);
        drag.current = { kind: "card-rotate", index, rect: card };
      } else if (card && isHandle(hit)) {
        select(index);
        drag.current = { kind: "card-resize", index, handle: hit, start: doc, rect: card };
        startHold(hit, p, page);
      } else if (card && hit === "card") {
        const before = pickedOnPage();
        if (adding) ed.togglePickedCard(currentPage, index);
        // A piece that is already among several picked ones moves them all; another one is picked alone.
        else if (before.includes(index) && before.length > 1)
          ed.pickCards(currentPage, [...before.filter((i) => i !== index), index]);
        else select(index);
        let indices = pickedOnPage();
        if (!indices.includes(index)) return; // taken out of the picked ones: nothing to drag
        // Alt-drag leaves the pieces where they were and drags copies of them.
        if (e.altKey) indices = copyPieces(currentPage, indices);
        const now = useLayoutStore.getState().freeform[currentPage] ?? NO_CARDS;
        drag.current = { kind: "card-move", indices, start: doc, rects: indices.map((i) => now[i]) };
      } else {
        // Dragging on empty page draws a new card; a bare click only drops the selection.
        if (!adding) select(null);
        drag.current = { kind: "card-create", anchor: doc, index: null };
      }
      return;
    }
    if (!group) return; // a skipped page has no region to edit
    const current = getCurrentSelection();
    // Pressing on the region, or drawing a new one, picks it: the arrow keys then move it.
    ed.setPickedRegion(currentPage);
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
    if (rulers) {
      const at = local(e);
      rulerX.current?.mark(at.x);
      rulerY.current?.mark(at.y);
    }
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
    if (d.kind === "guide") {
      trackGuide(d.axis, d.index, p);
      return;
    }
    const doc = screenToDocument(p, ed.viewport, page);
    // Snapping, unless Ctrl/Cmd is held; never in the magnifier's slow resize. The magnet decides the page and the
    // pieces, sticky edges the edges in the artwork; either way a line that snapped sticks for RELEASE_PX.
    const { snap: magnet, snapEdges: sticky } = usePreferencesStore.getState().prefs.editor;
    const free = e.ctrlKey || e.metaKey;
    const k = pxPerPoint(ed.viewport.zoom);
    const tol = snapTolerance(page, k);
    const release = snapTolerance(page, k, RELEASE_PX);
    const L0 = useLayoutStore.getState();
    const own0 = L0.freeform[currentPage] ?? NO_CARDS;
    /**
     * What to snap to: with the magnet, the page, the region and the pieces not in `skip`; with sticky edges, the
     * edges in the artwork that run along `box`'s sides (none when there is no upright box).
     */
    // The edges in the artwork among the targets, to tell when one of them holds a side.
    let fromEdges: SnapLines = NO_GUIDES;
    const targets = (skip: number[], withRegion: boolean, box: NormalizedRect | null) => {
      const others = own0.filter((_, i) => !skip.includes(i)).map((c) => cardBox(c, page));
      const region = getCurrentSelection();
      if (withRegion && region) others.push(region);
      // Guides show, and are snapped to, while the rulers are on.
      const ownGuides = useEditorStore.getState().guides[activeId];
      const lines = magnet
        ? joinLines(snapTargets(others), rulers && ownGuides ? guidesToNormalized(ownGuides, page) : NO_GUIDES)
        : NO_GUIDES;
      if (!sticky || !box) return lines;
      fromEdges = edgeTargets(box, edges.current);
      return joinLines(lines, fromEdges);
    };
    const snap = (moving: SnapLines, to: SnapLines) => {
      if (free) {
        stick.current = FREE;
        setGuides(NO_GUIDES);
        return { dx: 0, dy: 0 };
      }
      const s = stickyOffset(moving, to, tol, release, doc, stick.current);
      stick.current = s.state;
      setGuides(s.guides);
      if (s.guides.xs.some((x) => fromEdges.xs.includes(x)) || s.guides.ys.some((y) => fromEdges.ys.includes(y)))
        emitHintEvent("edge-stuck");
      return s;
    };
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
      if (d.kind === "card-move") {
        const [dx, dy] = [doc.x - d.start.x, doc.y - d.start.y];
        const box = union(
          d.rects.map((r) => cardBox({ ...r, center: { x: r.center.x + dx, y: r.center.y + dy } }, page)),
        );
        // Turned pieces are not along the page's axes: they snap by their box, but not to edges.
        const upright = d.rects.every((r) => r.angle_deg === 0);
        const s = snap(rectLines(box), targets(d.indices, true, upright ? box : null));
        movePieces(currentPage, d.indices, d.rects, dx + s.dx, dy + s.dy);
      } else if (d.kind === "card-rotate")
        L.updateFreeformCard(currentPage, d.index, rotateCardTo(d.rect, doc, page, e.shiftKey));
      else {
        const k = d.fine ? 1 / MAG : 1;
        const [dx, dy] = [(doc.x - d.start.x) * k, (doc.y - d.start.y) * k];
        const raw = resizeCard(d.rect, d.handle, dx, dy, page);
        // Only an upright piece's edges follow the page's axes, so only it snaps while resized.
        const s =
          d.fine || d.rect.angle_deg !== 0
            ? { dx: 0, dy: 0 }
            : snap(movedEdges(cardBox(raw, page), d.handle), targets([d.index], true, cardBox(raw, page)));
        L.updateFreeformCard(currentPage, d.index, resizeCard(d.rect, d.handle, dx + s.dx, dy + s.dy, page));
      }
      return;
    }
    if (d.kind === "create") {
      // The corner being drawn snaps.
      const s = snap({ xs: [doc.x], ys: [doc.y] }, targets([], false, rectFromPoints(d.anchor, doc)));
      setCurrentSelection(rectFromPoints(d.anchor, { x: doc.x + s.dx, y: doc.y + s.dy }));
    } else if (d.kind === "move") {
      const [dx, dy] = [doc.x - d.start.x, doc.y - d.start.y];
      const moved = moveRect(d.rect, dx, dy);
      const s = snap(rectLines(moved), targets([], false, moved));
      setCurrentSelection(moveRect(d.rect, dx + s.dx, dy + s.dy));
    } else {
      const k = d.fine ? 1 / MAG : 1;
      const [dx, dy] = [(doc.x - d.start.x) * k, (doc.y - d.start.y) * k];
      const raw = resizeRect(d.rect, d.handle, dx, dy);
      const s = d.fine ? { dx: 0, dy: 0 } : snap(movedEdges(raw, d.handle), targets([], false, raw));
      setCurrentSelection(resizeRect(d.rect, d.handle, dx + s.dx, dy + s.dy));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    stick.current = FREE;
    setPanning(false);
    setGuides(NO_GUIDES);
    endHold();
    setLoupe(null);
    if (d?.kind === "guide") {
      const g = guideDragRef.current;
      guideDragRef.current = null;
      setGuideDrag(null);
      const ed = useEditorStore.getState();
      if (g) ed.setGuides(activeId, dropGuide(ed.guides[activeId] ?? NO_GUIDE_SET, g.axis, g.index, g.pt, g.onRuler));
    }
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
      if (s && (s.width < MIN_CLICK_DRAG || s.height < MIN_CLICK_DRAG)) {
        setCurrentSelection(null);
        useEditorStore.getState().setPickedRegion(null);
      }
    }
    endEdit();
  };

  const pageRect = viewPage ? pageScreenRect(viewport, viewPage) : null;
  const selScreen = page && selection ? rectToScreen(selection, viewport, page) : null;
  const cursor = panMode ? (panning ? "grabbing" : "grab") : "crosshair";

  const split = viewMode === "split" && !!page;
  const unit = usePreferencesStore((s) => s.prefs.measurement.unit);
  // The rulers measure the source page: the Original view and the Original side of Split.
  const pxPerMm = pxPerPoint(viewport.zoom) * mmToPt(1);
  const ruler = (axis: "x" | "y") => (
    <Ruler
      axis={axis}
      ref={axis === "x" ? rulerX : rulerY}
      lengthPx={axis === "x" ? box.width : box.height}
      originPx={axis === "x" ? viewport.panX : viewport.panY}
      pxPerMm={pxPerMm}
      unit={unit}
      onPointerDown={onRulerDown(axis === "x" ? "top" : "left")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
  return (
    <div className="flex h-full w-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {rulers && (
          <div className="flex shrink-0">
            <RulerCorner
              hasGuides={rulerGuides.xs.length + rulerGuides.ys.length > 0}
              onClear={() => useEditorStore.getState().setGuides(activeId, NO_GUIDE_SET)}
            />
            {ruler("x")}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {rulers && ruler("y")}
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
                  onPointerLeave={() => {
                    rulerX.current?.mark(null);
                    rulerY.current?.mark(null);
                    if (!drag.current) setLoupe(null);
                  }}
                >
                  {rulers && (
                    // Under the region and the pieces, so a guide along a side never takes their handles.
                    <GuideLines
                      guides={rulerGuides}
                      dragging={guideDrag}
                      viewport={viewport}
                      page={page}
                      box={box}
                      grabbable={!panMode}
                      unit={unit}
                    />
                  )}
                  {!output && selection && gridSpec && (
                    <GridOverlay selection={selection} grid={gridSpec} viewport={viewport} page={page} />
                  )}
                  {!output && selScreen && (
                    // In the card tool the grid region is only a backdrop: it must not catch the pointer.
                    <g pointerEvents={tool === "card" ? "none" : undefined}>
                      <SelectionRect
                        screen={selScreen}
                        movable={!panMode && tool !== "card"}
                        picked={tool === "select" && pickedRegion === currentPage}
                      />
                    </g>
                  )}
                  {!output && freeform.length > 0 && (
                    <FreeformOverlay
                      cards={freeform}
                      selected={single ? picked : null}
                      picked={pickedHere}
                      viewport={viewport}
                      page={page}
                      interactive={cardTool}
                    />
                  )}
                  {!output && <DetectOverlay viewport={viewport} page={page} />}
                  {!output && (guides.xs.length > 0 || guides.ys.length > 0) && (
                    <g pointerEvents="none" data-testid="snap-guides">
                      {guides.xs.map((x) => {
                        const [a, b] = [
                          documentToScreen({ x, y: 0 }, viewport, page),
                          documentToScreen({ x, y: 1 }, viewport, page),
                        ];
                        return (
                          <line key={`x${x}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f43f5e" strokeWidth={1} />
                        );
                      })}
                      {guides.ys.map((y) => {
                        const [a, b] = [
                          documentToScreen({ x: 0, y }, viewport, page),
                          documentToScreen({ x: 1, y }, viewport, page),
                        ];
                        return (
                          <line key={`y${y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f43f5e" strokeWidth={1} />
                        );
                      })}
                    </g>
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
                {!output && (
                  <DetectDraftBar className="absolute bottom-3 left-1/2 z-20 w-[26rem] max-w-[90%] -translate-x-1/2" />
                )}
                {!output && !cardTool && hasGridAndPieces && (
                  <HintToast
                    hint="grid-and-pieces"
                    className="absolute left-1/2 top-3 z-30 w-[22rem] max-w-[90%] -translate-x-1/2"
                  />
                )}
                {!output && tool === "select" && !panMode && selection && !hasGridAndPieces && (
                  <HintToast
                    hint="move-region"
                    className="absolute left-1/2 top-3 z-30 w-[22rem] max-w-[90%] -translate-x-1/2"
                  />
                )}
                {!output && <StickyEdgesTip />}
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
        </div>
      </div>
      {split && <div className="w-px shrink-0 bg-[var(--border)]" />}
      {split && <OutputPane />}
    </div>
  );
}
