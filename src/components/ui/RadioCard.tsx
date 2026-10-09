import { createContext, useContext } from "react";
import { radioGroupKeys } from "./radio-keys";

type Group = { value: string; onChange: (value: string) => void; disabled?: boolean };
const GroupContext = createContext<Group | null>(null);

/** A set of RadioCards: one radio group, arrows move and select. */
export function RadioCardGroup<T extends string>({
  value,
  onChange,
  label,
  disabled,
  className = "",
  children,
}: {
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <GroupContext.Provider value={{ value, onChange: onChange as (v: string) => void, disabled }}>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={radioGroupKeys}
        className={`flex flex-col gap-1.5 ${className}`}
      >
        {children}
      </div>
    </GroupContext.Provider>
  );
}

/**
 * An option that needs a description: a title and one line under it. `children` is extra content that belongs to
 * the option (fields that only matter when it is chosen); it sits below the card's button, not inside it.
 */
export function RadioCard({
  value,
  title,
  description,
  disabled,
  children,
}: {
  value: string;
  title: string;
  description?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const group = useContext(GroupContext);
  if (!group) throw new Error("RadioCard must be inside a RadioCardGroup");
  const checked = group.value === value;
  const off = disabled || group.disabled;
  return (
    <div
      className={`rounded border ${checked ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"} ${off ? "opacity-50" : ""}`}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a styled button with the ARIA role: a native input cannot be restyled */}
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        tabIndex={checked ? 0 : -1}
        disabled={off}
        onClick={() => group.onChange(value)}
        className="flex w-full items-start gap-2 rounded px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border ${checked ? "border-[var(--accent)]" : "border-[var(--muted)]"}`}
        >
          {checked && <span className="size-2 rounded-full bg-[var(--accent)]" />}
        </span>
        <span className="min-w-0">
          {title}
          {description && <span className="block text-[var(--muted)]">{description}</span>}
        </span>
      </button>
      {children && <div className="px-2.5 pb-1.5 pl-[34px]">{children}</div>}
    </div>
  );
}
