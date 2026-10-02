import { useEffect, useRef, useState } from "react";

/**
 * Numeric input that commits on Enter/blur and reverts on Escape, so typing
 * "6", "63", "63.5" doesn't fire an update (and a clamp) per keystroke.
 */
export function NumberField({
  value, onCommit, decimals = 0, min, max, step = 1, suffix, disabled, label,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  decimals?: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  label: string;
}) {
  const fmt = (v: number | null) => (v === null ? "" : v.toFixed(decimals));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  // Follow external changes (e.g. dragging the selection) unless the user is typing.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value, decimals]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(n)) {
      onCommit(Math.min(Math.max(n, min ?? -Infinity), max ?? Infinity));
    }
    setText(fmt(value));
  };

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          aria-label={label}
          disabled={disabled}
          inputMode="decimal"
          value={text}
          placeholder="—"
          onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") { setText(fmt(value)); e.currentTarget.blur(); }
            else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== null) {
              e.preventDefault();
              onCommit(Math.min(Math.max(value + (e.key === "ArrowUp" ? step : -step), min ?? -Infinity), max ?? Infinity));
            }
          }}
          className="w-16 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-[var(--accent)] disabled:opacity-40"
        />
        {suffix && <span className="w-5 text-[10px] text-[var(--muted)]">{suffix}</span>}
      </span>
    </label>
  );
}
