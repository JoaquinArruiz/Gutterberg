import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean };

/**
 * Dropdown that looks like the rest of the app (the native <select> list is drawn by the OS).
 * Keyboard: Enter/Space/Arrows open; Arrows, Home/End move; Enter/Space pick; Esc/Tab close.
 * The list is position: fixed, so scrolling or overflow-hidden containers never clip it.
 */
export function Select<T extends string>({
  value, options, onChange, label, className = "", testId,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name. */
  label: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (o: SelectOption<T>) => {
    if (o.disabled) return;
    onChange(o.value);
    close();
    btn.current?.focus();
  };

  // Place under the trigger, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < Math.min(options.length * 28 + 8, 200) && above > below;
    setPos({
      left: r.left,
      minWidth: r.width,
      top: flip ? Math.max(8, r.top - 4 - Math.min(options.length * 28 + 8, above)) : r.bottom + 4,
      maxHeight: Math.max(96, flip ? above : below),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const away = () => close(); // scroll/resize would leave the fixed list stranded
    window.addEventListener("pointerdown", down);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open]);

  // Keep the keyboard-active option in view.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, pos]);

  const move = (dir: 1 | -1) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(options.length - 1); break;
      case "Enter": case " ": e.preventDefault(); pick(options[active]); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); close(); break; // don't also close a parent dialog
      case "Tab": close(); break;
    }
  };

  return (
    <div className={`relative inline-block ${className}`} data-testid={testId}>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className="flex w-full min-w-28 items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-left outline-none hover:border-[var(--muted)] focus-visible:border-[var(--accent)] aria-expanded:border-[var(--accent)]"
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <ChevronDown size={12} className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          style={{ position: "fixed", left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
          className="z-[60] overflow-y-auto rounded border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl shadow-black/40"
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              onPointerEnter={() => !o.disabled && setActive(i)}
              onClick={() => pick(o)}
              className={`flex cursor-default items-center gap-2 whitespace-nowrap rounded px-2 py-1 ${i === active ? "bg-[var(--hover)]" : ""} ${o.disabled ? "opacity-40" : ""}`}
            >
              <span className="flex w-3 shrink-0 text-[var(--accent)]">{o.value === value && <Check size={12} />}</span>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
