import { useEffect, useRef, useState } from "react";

/** The pointer must move this far (px) before a press on a card becomes a drag. */
const DRAG_THRESHOLD_PX = 5;
/** Near the top or bottom of the list, dragging scrolls it. */
const EDGE_PX = 28;
const SCROLL_STEP_PX = 14;

type Drag = { keys: string[]; target: { key: string; after: boolean } | null };

/**
 * Drag cards in the library to reorder them. A press on a card that moves past a small threshold starts
 * a drag of the selection (or of just that card when it is not selected); the card under the pointer
 * (any element with `data-card`) is the drop target, before or after it by which half the pointer is in.
 * Pointer events, not the browser's drag and drop, so it behaves the same in every webview.
 */
export function useCardDrag({
  scrollRef,
  selected,
  onDrop,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Keys of the selected cards. */
  selected: string[];
  onDrop: (keys: string[], targetKey: string, after: boolean) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ key: string; x: number; y: number; started: Drag | null } | null>(null);
  const moved = useRef(false);
  const latest = useRef({ selected, onDrop });
  latest.current = { selected, onDrop };
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const targetAt = (x: number, y: number, keys: string[]): Drag["target"] => {
    const el = document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-card]");
    const key = el?.dataset.card;
    if (!el || !key || keys.includes(key)) return null;
    const r = el.getBoundingClientRect();
    return { key, after: x > r.left + r.width / 2 };
  };

  const onPointerDown = (key: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cleanup.current?.();
    const p = { key, x: e.clientX, y: e.clientY, started: null as Drag | null };
    press.current = p;
    moved.current = false;

    const move = (ev: PointerEvent) => {
      if (!p.started) {
        if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < DRAG_THRESHOLD_PX) return;
        const keys = latest.current.selected.includes(p.key) ? latest.current.selected : [p.key];
        p.started = { keys, target: null };
        moved.current = true;
      }
      const el = scrollRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (ev.clientY < r.top + EDGE_PX) el.scrollTop -= SCROLL_STEP_PX;
        else if (ev.clientY > r.bottom - EDGE_PX) el.scrollTop += SCROLL_STEP_PX;
      }
      const next = { keys: p.started.keys, target: targetAt(ev.clientX, ev.clientY, p.started.keys) };
      p.started = next;
      setDrag(next);
    };
    const up = () => {
      const done = p.started;
      cleanup.current?.();
      if (done?.target) latest.current.onDrop(done.keys, done.target.key, done.target.after);
      // The click that follows this release must not also select the card; a later click is normal again.
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
      press.current = null;
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
