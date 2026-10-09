import { Check } from "lucide-react";
import { useId } from "react";
import { InfoTip } from "./InfoTip";

/**
 * A tick box for items in a list or a single yes/no choice: `role="checkbox"`, Space toggles it. Without a `label`
 * it is just the box, so give it an `aria-label`. `info` adds an InfoTip after the label.
 */
export function Checkbox({
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
  const box = (
    // biome-ignore lint/a11y/useSemanticElements: a styled button with the ARIA role: a native input cannot be restyled
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...aria}
      className={`mt-px flex size-3.5 shrink-0 ${disabled ? "opacity-50" : ""} items-center justify-center rounded-[3px] border outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)] ${checked ? "border-[var(--accent)] bg-[var(--accent)] text-black" : "border-[var(--muted)] bg-transparent"} ${label === undefined ? className : ""}`}
    >
      {checked && <Check size={11} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
  if (label === undefined) return box;
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      {box}
      <div className={`min-w-0 flex-1 ${disabled ? "opacity-50" : ""}`}>
        <label htmlFor={id}>{label}</label>
        {hint && <div className="text-[var(--muted)]">{hint}</div>}
      </div>
      {info && <InfoTip text={info} className="mt-0.5" />}
    </div>
  );
}
