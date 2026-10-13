import { createContext, useContext } from "react";
import { InfoTip } from "./InfoTip";

/**
 * How a settings panel lays out its fields: `inline` (the label on the left, the control on the right, as wide as it
 * is) or `column` (every label in one column, every control starting at the same place and filling the rest of the
 * row). The Print tab's panels are `column`; `NumberField` follows it, so a field there needs no change.
 */
export type FieldLayoutMode = "inline" | "column";
export const FieldLayout = createContext<FieldLayoutMode>("inline");
export const useFieldLayout = () => useContext(FieldLayout);

/** The track widths of a row: a label column, and the controls. One place, so every row lines up with every other. */
export const FIELD_ROW_COLUMNS = "grid-cols-[minmax(5.5rem,34%)_minmax(0,1fr)]";

/**
 * One row of a settings panel: its label (with an optional help tip) in the label column and its control in the
 * other, filling the width. `label` null leaves the label column empty, for a control that belongs to the row above
 * (such as the buttons under a field).
 */
export function FieldRow({
  label,
  info,
  children,
  className = "",
  ...rest
}: {
  label: string | null;
  /** A one-line explanation, behind an InfoTip after the label. */
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  "data-hint-target"?: string;
  "data-testid"?: string;
}) {
  return (
    <div {...rest} className={`grid items-center gap-x-2 gap-y-1 ${FIELD_ROW_COLUMNS} ${className}`}>
      <span className="flex min-w-0 items-center gap-1 leading-tight text-[var(--muted)]">
        {label !== null && <span className="min-w-0 break-words">{label}</span>}
        {label !== null && info && <InfoTip text={info} />}
      </span>
      <div className="flex min-w-0 items-center gap-1 [&>*]:min-w-0">{children}</div>
    </div>
  );
}
