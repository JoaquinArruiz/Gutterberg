import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const WIDTH = 240;
const GAP = 6;

/**
 * A small circled "i" after a label or a section title; the explanation opens on hover, keyboard focus and click,
 * and Esc closes it. The text is also always the button's description for screen readers (`aria-describedby`),
 * so it is announced without opening anything. Only explanations belong here: warnings, errors and anything the
 * user must act on stay visible.
 */
export function InfoTip({ text, className = "" }: { text: React.ReactNode; className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = hover || focus || pinned;

  const close = useCallback(() => {
    setHover(false);
    setFocus(false);
    setPinned(false);
  }, []);

  // Under the "i", or above it when there is no room; kept inside the window. `position: fixed`, so a scrolling or
  // overflow-hidden panel never clips it.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    setPos({ left, top: below < 110 && r.top > below ? r.top - GAP : r.bottom + GAP });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // not also the dialog the tip may be in
      e.stopPropagation();
      close();
    };
    const down = (e: PointerEvent) => !btn.current?.contains(e.target as Node) && setPinned(false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", down);
    };
  }, [open, close]);

  const above = pos !== null && btn.current !== null && pos.top < btn.current.getBoundingClientRect().top;
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-label={t("ui.infoTip")}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => (pinned ? close() : setPinned(true))}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        className="flex rounded-full text-[var(--muted)] outline-none hover:text-[var(--fg)] focus-visible:text-[var(--accent)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        <Info size={13} />
      </button>
      <span id={id} className="sr-only">
        {text}
      </span>
      {open && pos && (
        <span
          aria-hidden="true"
          data-testid="info-tip-bubble"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: Math.min(WIDTH, window.innerWidth - 16),
            transform: above ? "translateY(-100%)" : undefined,
          }}
          className="pointer-events-none z-[70] whitespace-normal rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-[var(--fg)] shadow-xl shadow-black/40"
        >
          {text}
        </span>
      )}
    </span>
  );
}
