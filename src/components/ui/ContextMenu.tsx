import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { menuItem } from "../workspace/Popover";

/** One line of a right-click menu: an action, or a thin line between groups of them. */
export type MenuEntry = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean } | "separator";

type MenuState = { at: { x: number; y: number } | null; entries: MenuEntry[] };

const useMenuStore = create<MenuState>(() => ({ at: null, entries: [] }));

/**
 * Opens the right-click menu at the pointer with `entries` (the page, a row of the Grids list, a colour). The
 * browser's own menu is held back. One menu at a time; it closes on a choice, a press outside it, Esc or scrolling.
 */
export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault: () => void },
  entries: MenuEntry[],
) {
  e.preventDefault();
  if (entries.length === 0) return;
  useMenuStore.setState({ at: { x: e.clientX, y: e.clientY }, entries });
}

export function closeContextMenu() {
  useMenuStore.setState({ at: null, entries: [] });
}

/** The right-click menu, drawn once at the top of the app. Arrow keys move between items, Enter picks one. */
export function ContextMenuHost() {
  const at = useMenuStore((s) => s.at);
  const entries = useMenuStore((s) => s.entries);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Keep it inside the window: flipped left or up when there is no room.
  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: at.x + r.width > window.innerWidth ? Math.max(0, at.x - r.width) : at.x,
      top: at.y + r.height > window.innerHeight ? Math.max(0, at.y - r.height) : at.y,
    });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && closeContextMenu();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", closeContextMenu, true);
    window.addEventListener("blur", closeContextMenu);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", closeContextMenu, true);
      window.removeEventListener("blur", closeContextMenu);
    };
  }, [at]);

  if (!at) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      style={{ position: "fixed", left: pos?.left ?? at.x, top: pos?.top ?? at.y }}
      className="z-[60] min-w-44 rounded border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl shadow-black/40"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === "separator" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
          <hr key={`s${i}`} className="my-1 border-[var(--border)]" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={`${menuItem} ${entry.danger ? "text-red-400" : ""}`}
            onClick={() => {
              closeContextMenu();
              entry.onSelect();
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
