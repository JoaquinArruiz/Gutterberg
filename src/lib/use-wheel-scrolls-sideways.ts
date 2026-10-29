import { type RefObject, useEffect } from "react";

/** Pixels per line and per page for wheels that count in lines or pages (`WheelEvent.deltaMode`). */
const LINE_PX = 16;

/**
 * Makes an ordinary mouse wheel scroll a horizontal strip (the sheets, the pages docked at the top or bottom),
 * which otherwise only Shift+wheel, a trackpad or the scrollbar move. Only a mostly vertical wheel without Ctrl
 * or Cmd, and only while the strip has more than it shows; a sideways swipe keeps its own way, and at either end
 * the wheel goes on to whatever is around the strip. `enabled` false leaves the strip alone (a vertical list).
 */
export function useWheelScrollsSideways(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const step = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? el.clientWidth : 1;
      const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY * step));
      if (next === el.scrollLeft) return;
      el.scrollLeft = next;
      e.preventDefault();
    };
    // Not React's onWheel, which is passive and so cannot keep the page from scrolling as well.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, enabled]);
}
