import { useEffect, useRef, useState } from "react";

/**
 * Numeric input that commits on Enter/blur and reverts on Escape, so typing
 * "6", "63", "63.5" doesn't fire an update (and a clamp) per keystroke.
 */
export function NumberField({
  value,
  onCommit,
  decimals = 0,
  min,
  max,
  step = 1,
  fineStep,
  coarseStep,
  suffix,
  disabled,
  label,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  decimals?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Alt+arrow / Shift+arrow increments (defaults: 0.1 when decimals are shown / at least 1). */
  fineStep?: number;
  coarseStep?: number;
  suffix?: string;
  disabled?: boolean;
  label: string;
}) {
  const fmt = (v: number | null) => (v === null ? "" : v.toFixed(decimals));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  // Follow external changes (e.g. dragging the selection) unless the user is typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fmt` is recreated every render; `decimals` is its input
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value, decimals]);

  const clampV = (v: number) => Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity);
  // Round away float noise (3.1 + 0.1 = 3.1000000000000005).
  const nudge = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    if (value === null) return;
    const amount = e.shiftKey
      ? (coarseStep ?? Math.max(step, 1))
      : e.altKey && (fineStep !== undefined || decimals > 0)
        ? (fineStep ?? 0.1)
        : step;
    onCommit(clampV(Number((value + dir * amount).toFixed(Math.max(decimals, 3)))));
  };

  const commit = () => {
    const n = Number(text.replace(",", "."));
    // Only commit a real edit. The shown text is rounded, so committing it
    // unchanged would overwrite the exact value (3 mm -> "0.118 in" -> 2.997 mm).
    if (text !== fmt(value) && text.trim() !== "" && Number.isFinite(n)) {
      onCommit(clampV(n));
    }
    setText(fmt(value));
  };

  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease ${label}`}
          disabled={disabled || value === null || (min !== undefined && value <= min)}
          onClick={(e) => nudge(-1, e)}
          className="h-5 w-5 rounded border border-[var(--border)] leading-none hover:bg-[var(--hover)] disabled:opacity-30"
        >
          −
        </button>
        <input
          aria-label={label}
          disabled={disabled}
          inputMode="decimal"
          value={text}
          placeholder="—"
          onFocus={(e) => {
            focused.current = true;
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setText(fmt(value));
              e.currentTarget.blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              nudge(e.key === "ArrowUp" ? 1 : -1, e);
            }
          }}
          className="w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-right tabular-nums outline-none focus:border-[var(--accent)] disabled:opacity-40"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase ${label}`}
          disabled={disabled || value === null || (max !== undefined && value >= max)}
          onClick={(e) => nudge(1, e)}
          className="h-5 w-5 rounded border border-[var(--border)] leading-none hover:bg-[var(--hover)] disabled:opacity-30"
        >
          +
        </button>
        {suffix && <span className="w-5 text-[10px] text-[var(--muted)]">{suffix}</span>}
      </span>
    </label>
  );
}
