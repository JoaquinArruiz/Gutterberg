// What the keyboard (and Alt-drag) does to what is picked on the page (0.14.0): move it by a step, copy it, pick every
// piece, delete the picked pieces. The pointer work stays in `EditorViewport`; these act on the stores, so the
// shortcuts in `App.tsx` and the tests call the same thing.

import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import {
  beginEdit,
  endEdit,
  getCurrentSelection,
  getPickedFolderGrids,
  isCurrentGridHidden,
  setCurrentSelection,
  useLayoutStore,
} from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import type { OrientedRect } from "./card";
import { clamp, type NormalizedRect } from "./coordinates";
import { moveRect, moveRectsTogether } from "./selection";
import { mmToPt } from "./units";

/** A burst of arrow presses closer together than this is one undo step. */
export const NUDGE_BURST_MS = 600;
/** How far a copy made with Duplicate lands from its original, down and to the right. */
export const DUPLICATE_OFFSET_MM = 5;

/** One arrow press, in mm: 1 mm, or 0.05 in when the unit is inches; with Shift ten times that. */
export function nudgeStepMm(big: boolean): number {
  const step = usePreferencesStore.getState().prefs.measurement.unit === "in" ? 1.27 : 1;
  return big ? step * 10 : step;
}

/** The picked pieces of the viewed page, by index; empty when the picked ones are on another page. */
export function pickedOnPage(): number[] {
  const { selectedCard, pickedCards } = useEditorStore.getState();
  const page = useDocumentStore.getState().currentPage;
  const own = useLayoutStore.getState().freeform[page] ?? [];
  return selectedCard?.page === page ? pickedCards.filter((i) => i < own.length) : [];
}

/**
 * The pieces `indices` of `page` as they were (`from`), moved by (dx, dy) normalized together: the move is cut short
 * so that every centre stays on the page, so a group keeps its shape at the edge.
 */
export function movePieces(page: number, indices: number[], from: OrientedRect[], dx: number, dy: number) {
  if (indices.length === 0) return;
  const [minX, maxX] = [Math.max(...from.map((c) => -c.center.x)), Math.min(...from.map((c) => 1 - c.center.x))];
  const [minY, maxY] = [Math.max(...from.map((c) => -c.center.y)), Math.min(...from.map((c) => 1 - c.center.y))];
  const [x, y] = [clamp(dx, minX, maxX), clamp(dy, minY, maxY)];
  const L = useLayoutStore.getState();
  indices.forEach((index, k) => {
    const c = from[k];
    L.updateFreeformCard(page, index, { ...c, center: { x: c.center.x + x, y: c.center.y + y } });
  });
}

let burst: ReturnType<typeof setTimeout> | undefined;
/** Keeps the history open while presses keep coming, and closes it once they stop. */
function inBurst() {
  beginEdit();
  clearTimeout(burst);
  burst = setTimeout(() => {
    burst = undefined;
    endEdit();
  }, NUDGE_BURST_MS);
}

/**
 * The arrow keys: moves the picked pieces (with the Piece tool) or the picked grid region (with the Grid region tool)
 * one step in (dirX, dirY). Returns false when nothing is picked, so the arrows can change page instead.
 */
export function nudgePicked(dirX: number, dirY: number, big: boolean): boolean {
  const page = useDocumentStore.getState().pages[useDocumentStore.getState().currentPage];
  const current = useDocumentStore.getState().currentPage;
  const ed = useEditorStore.getState();
  if (!page) return false;
  const step = mmToPt(nudgeStepMm(big));
  const [dx, dy] = [(dirX * step) / page.width_pt, (dirY * step) / page.height_pt];
  // With the Select tool, the picked pieces when there are any, else the picked region.
  const pieces = ed.tool === "card" || (ed.tool === "pick" && pickedOnPage().length > 0);
  if (pieces) {
    const picked = pickedOnPage();
    if (picked.length === 0) return false;
    const own = useLayoutStore.getState().freeform[current] ?? [];
    inBurst();
    movePieces(
      current,
      picked,
      picked.map((i) => own[i]),
      dx,
      dy,
    );
    return true;
  }
  if ((ed.tool === "grid" || ed.tool === "pick") && ed.pickedRegion === current) {
    // A picked folder moves as one.
    const folder = getPickedFolderGrids();
    if (folder.length > 0) {
      inBurst();
      moveGridsBy(current, folder, dx, dy);
      return true;
    }
    const region = getCurrentSelection();
    if (!region || isCurrentGridHidden()) return false;
    inBurst();
    setCurrentSelection(moveRect(region, dx, dy));
    return true;
  }
  return false;
}

/** Moves the regions `grids` of `page`'s group by (dx, dy) normalized, together (see `moveRectsTogether`). */
export function moveGridsBy(page: number, grids: { n: number; selection: NormalizedRect }[], dx: number, dy: number) {
  const moved = moveRectsTogether(
    grids.map((g) => g.selection),
    dx,
    dy,
  );
  useLayoutStore.getState().moveGrids(
    page,
    grids.map((g, i) => ({ n: g.n, selection: moved[i] })),
  );
}

/**
 * Copies the pieces `indices` of `page`, moved by (dx, dy) normalized (each kept on the page), at the end of the
 * page's pieces, and picks the copies. Copies start with no turn, size, back or copies of their own. Returns their
 * indices.
 */
export function copyPieces(page: number, indices: number[], dx = 0, dy = 0): number[] {
  const L = useLayoutStore.getState();
  const own = L.freeform[page] ?? [];
  const copies = indices
    .filter((i) => own[i])
    .map((i) =>
      L.addFreeformCard(page, {
        ...own[i],
        center: { x: clamp(own[i].center.x + dx, 0, 1), y: clamp(own[i].center.y + dy, 0, 1) },
      }),
    );
  useEditorStore.getState().pickCards(page, copies);
  return copies;
}

/** `Ctrl/Cmd+D`: copies the picked pieces a little down and to the right, as one undo step. */
export function duplicatePicked(): boolean {
  const picked = pickedOnPage();
  const { pages, currentPage } = useDocumentStore.getState();
  const page = pages[currentPage];
  const { tool } = useEditorStore.getState();
  if (picked.length === 0 || !page || (tool !== "card" && tool !== "pick")) return false;
  const off = mmToPt(DUPLICATE_OFFSET_MM);
  beginEdit();
  copyPieces(currentPage, picked, off / page.width_pt, off / page.height_pt);
  endEdit();
  return true;
}

/** `Ctrl/Cmd+A`: picks every piece of the viewed page, with the Piece tool. False when the page has none. */
export function pickAllPieces(): boolean {
  const current = useDocumentStore.getState().currentPage;
  const own = useLayoutStore.getState().freeform[current] ?? [];
  if (own.length === 0) return false;
  const ed = useEditorStore.getState();
  if (ed.tool !== "pick") ed.setTool("card");
  ed.pickCards(
    current,
    own.map((_, i) => i),
  );
  return true;
}

/** `Delete` (with the Piece tool) and the sidebar's Delete button: removes the picked pieces, as one undo step. */
export function deletePicked(): boolean {
  const picked = pickedOnPage();
  if (picked.length === 0) return false;
  const current = useDocumentStore.getState().currentPage;
  beginEdit();
  // From the last, so the indices still to delete do not move.
  for (const i of [...picked].sort((a, b) => b - a)) useLayoutStore.getState().deleteFreeformCard(current, i);
  endEdit();
  useEditorStore.getState().setSelectedCard(null);
  return true;
}
