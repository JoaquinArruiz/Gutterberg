import { convertFromCanonical, convertToCanonical, UNIT_DECIMALS, UNIT_STEPS } from "../../lib/measurement";
import { useUnit } from "../../stores/preferences-store";
import { NumberField } from "./NumberField";

/**
 * A length input in the user's preferred unit. `value`, `min`, `max` and
 * `onChange` are canonical millimetres; conversion happens only here, so the
 * preference changes how the number looks, never what it is.
 */
export function MeasurementInput({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  precise,
}: {
  label: string;
  /** Canonical mm, or null for an empty field. */
  value: number | null;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** Small default steps (card sizes and positions) instead of the gap-sized ones. */
  precise?: boolean;
}) {
  const unit = useUnit();
  const to = (mm?: number) => (mm === undefined ? undefined : convertFromCanonical(mm, unit));
  const base = UNIT_STEPS[unit];
  const steps = precise ? { step: base.fine, fine: base.fine / 5, coarse: base.step } : base;
  return (
    <NumberField
      label={label}
      suffix={unit}
      decimals={UNIT_DECIMALS[unit]}
      step={steps.step}
      fineStep={steps.fine}
      coarseStep={steps.coarse}
      min={to(min)}
      max={to(max)}
      disabled={disabled}
      value={value === null ? null : convertFromCanonical(value, unit)}
      onCommit={(v) => onChange(convertToCanonical(v, unit))}
    />
  );
}
