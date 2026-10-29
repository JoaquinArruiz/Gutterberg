import type React from "react";
import { type PiecePeek, useUiStore } from "../../stores/ui-store";

/** How long the right button must stay down for the release to close the piece again. */
export const PEEK_HOLD_MS = 250;

/**
 * The right button on a piece of the Print tab shows it large (`PiecePeek`). Held down, it shows while the button
 * is down and goes when it is let go; a quick right-click (or a trackpad's two-finger click) leaves it open until a
 * click, a right-click or `Esc`. The web view's own menu never opens on a piece. `peek` is read when it is needed,
 * so it may change between renders.
 */
export function usePiecePeek(peek: () => PiecePeek) {
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 2) return;
    const setPeek = useUiStore.getState().setPeek;
    const start = performance.now();
    const shown = peek();
    const timer = setTimeout(() => setPeek(shown), PEEK_HOLD_MS);
    const up = (u: PointerEvent) => {
      if (u.button !== 2) return;
      clearTimeout(timer);
      window.removeEventListener("pointerup", up, true);
      setPeek(performance.now() - start >= PEEK_HOLD_MS ? null : shown);
    };
    window.addEventListener("pointerup", up, true);
  };
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();
  return { onPointerDown, onContextMenu };
}
