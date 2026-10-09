import { radioGroupKeys } from "./radio-keys";

export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean };

/**
 * Two or three short options in one row, styled like the Source / Print tabs. A radio group: Tab reaches the chosen
 * one, the arrows move and select.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  fill,
  className = "",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
  /** Take the whole row, the options sharing it equally (their text wraps rather than being cut). */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={radioGroupKeys}
      className={`${fill ? "flex w-full" : "inline-flex max-w-full"} gap-0.5 rounded border border-[var(--border)] p-0.5 ${disabled ? "opacity-50" : ""} ${className}`}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled button with the ARIA role: a native input cannot be restyled
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={`min-w-0 rounded px-2 py-0.5 ${fill ? "flex-1 text-center" : ""} outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-40 ${checked ? "bg-[var(--active)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
