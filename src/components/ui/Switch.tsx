import { useId } from "react";
import { InfoTip } from "./InfoTip";

/**
 * An on/off setting: `role="switch"`, Space/Enter toggle it, and the label is clickable too. `info` adds an
 * InfoTip after the label for the one-line explanation.
 */
export function Switch({
  checked,
  onChange,
  label,
  info,
  hint,
  disabled,
  className = "",
  ...aria
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  info?: React.ReactNode;
  /** A line of text under the label that stays visible (for Preferences, where there is room). */
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        {...aria}
        className={`relative mt-px h-4 w-7 shrink-0 ${disabled ? "opacity-50" : ""} rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)] ${checked ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--muted)] bg-transparent"}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-px size-3 rounded-full transition-all ${checked ? "left-[13px] bg-black" : "left-px bg-[var(--muted)]"}`}
        />
      </button>
      {label !== undefined && (
        <div className={`min-w-0 flex-1 ${disabled ? "opacity-50" : ""}`}>
          <label htmlFor={id}>{label}</label>
          {hint && <div className="text-[var(--muted)]">{hint}</div>}
        </div>
      )}
      {info && <InfoTip text={info} className="mt-0.5" />}
    </div>
  );
}
