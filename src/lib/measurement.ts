// Display/input units for physical measurements.
//
// The document model keeps lengths in millimetres (the UI state) and PDF points
// (the Rust engine). The unit chosen in Preferences only changes how a length
// is SHOWN and TYPED: values are converted at the edge, never stored converted,
// so switching units any number of times cannot drift the geometry.

import { decimalSeparator } from "./locale";
import { MM_PER_INCH } from "./units";

export type MeasurementUnit = "mm" | "cm" | "in";
export const MEASUREMENT_UNITS: MeasurementUnit[] = ["mm", "cm", "in"];

/** Canonical mm per one display unit. */
const MM_PER_UNIT: Record<MeasurementUnit, number> = { mm: 1, cm: 10, in: MM_PER_INCH };

/** Decimals shown per unit (display only). */
export const UNIT_DECIMALS: Record<MeasurementUnit, number> = { mm: 2, cm: 3, in: 3 };

/** Stepper increments in display units: normal, fine (Alt), coarse (Shift). */
export const UNIT_STEPS: Record<MeasurementUnit, { step: number; fine: number; coarse: number }> = {
  mm: { step: 0.5, fine: 0.1, coarse: 1 },
  cm: { step: 0.05, fine: 0.01, coarse: 0.1 },
  in: { step: 0.02, fine: 0.005, coarse: 0.05 },
};

/** Canonical (mm) -> display value. Not rounded: rounding is for formatting only. */
export const convertFromCanonical = (mm: number, unit: MeasurementUnit) => mm / MM_PER_UNIT[unit];

/** Display value -> canonical (mm). */
export const convertToCanonical = (value: number, unit: MeasurementUnit) => value * MM_PER_UNIT[unit];

/** A number with `decimals` places and the separator in effect ("63.5" or "63,5"). */
export function formatDecimal(value: number, decimals: number, separator = decimalSeparator()): string {
  const text = value.toFixed(decimals);
  return separator === "." ? text : text.replace(".", separator);
}

/**
 * The number typed in a field, or null when it is not one. Accepts "63.5" and "63,5" whatever the
 * display setting, so pasting from anywhere works. There are no thousands separators: a value with
 * both "." and ",", or with more than one separator, is rejected.
 */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace("\u2212", "-");
  if (!/^[+-]?(\d+[.,]?\d*|[.,]\d+)$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "3.00 mm", "0.300 cm", "0.118 in". `decimals` overrides the unit's default. */
export function formatMeasurement(mm: number, unit: MeasurementUnit, decimals = UNIT_DECIMALS[unit]) {
  return `${formatDecimal(convertFromCanonical(mm, unit), decimals)} ${unit}`;
}

/** Like [`formatMeasurement`] without the unit suffix. */
export const formatValue = (mm: number, unit: MeasurementUnit, decimals = UNIT_DECIMALS[unit]) =>
  formatDecimal(convertFromCanonical(mm, unit), decimals);
