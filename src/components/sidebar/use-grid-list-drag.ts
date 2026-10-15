import { useEffect, useRef, useState } from "react";
import type { ListDrop, ListRef } from "../../lib/document-layout";

/** The pointer must move this far (px) before a press on a row becomes a drag. */
const DRAG_THRESHOLD_PX = 5;
/** On a folder's row, a grid dropped in this top part goes before the folder; below it, into the folder. */
const BEFORE_FOLDER = 0.3;

export type ListDrag = { item: ListRef; drop: ListDrop | null };

/** The `data-list-item` of a row: "g:<n>" for a grid, "f:<name>" for a folder. */
export const listItemKey = (r: ListRef) => (r.kind === "grid" ? `g:${r.n}` : `f:${r.name}`);
const parseKey = (k: string): ListRef =>
  k.startsWith("g:") ? { kind: "grid", n: Number(k.slice(2)) } : { kind: "folder", name: k.slice(2) };

/**
 * Drag grids and folders in the Grids list to put them in another order, or a grid into a folder. A press on a row
 * that moves past a small threshold starts a drag; the row under the pointer (any element with `data-list-item`, and
 * `data-list-folder` naming the folder a grid's row is in) is the drop target: before or after it by which half the
 * pointer is in, or into a folder when a grid is over the lower part of the folder's row. Pointer events, like the
 * piece library's drag, so it behaves the same in every webview.
 */
export function useGridListDrag(onDrop: (item: ListRef, drop: ListDrop) => void) {
  const [drag, setDrag] = useState<ListDrag | null>(null);
  const moved = useRef(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const dropAt = (x: number, y: number, item: ListRef): ListDrop | null => {
    const el = document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-list-item]");
    const key = el?.dataset.listItem;
    if (!el || !key) return null;
    const over = parseKey(key);
    // A folder is not dropped on itself or among its own grids.
    if (
      item.kind === "folder" &&
      (el.dataset.listFolder === item.name || (over.kind === "folder" && over.name === item.name))
    )
      return null;
    if (item.kind === "grid" && over.kind === "grid" && over.n === item.n) return null;
    const r = el.getBoundingClientRect();
    const share = r.height > 0 ? (y - r.top) / r.height : 0;
    if (over.kind === "folder" && item.kind === "grid")
      return share < BEFORE_FOLDER ? { place: "before", item: over } : { place: "into", folder: over.name };
    return { place: share < 0.5 ? "before" : "after", item: over };
  };

  const onPointerDown = (item: ListRef, e: React.PointerEvent) => {
    // Selecting text in a name field is not a drag.
    if (e.button !== 0 || (e.target as HTMLElement).closest?.("input")) return;
    cleanup.current?.();
    const start = { x: e.clientX, y: e.clientY };
    let current: ListDrag | null = null;
    moved.current = false;
    const move = (ev: PointerEvent) => {
      if (!current && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      moved.current = true;
      current = { item, drop: dropAt(ev.clientX, ev.clientY, item) };
      setDrag(current);
    };
    const up = () => {
      const done = current;
      cleanup.current?.();
      if (done?.drop) latest.current(done.item, done.drop);
      // The click that follows this release must not also pick the row; a later click is normal again.
      setTimeout(() => {
        moved.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanup.current = null;
      setDrag(null);
    };
  };

  return {
    drag,
    onPointerDown,
    /** True for the click that ends a drag: the caller should ignore it. */
    wasDrag: () => moved.current,
  };
}
