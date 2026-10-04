// Display/input units for physical measurements.
//
// The document model keeps lengths in millimetres (the UI state) and PDF points
// (the Rust engine). The unit chosen in Preferences only changes how a length
// is SHOWN and TYPED: values are converted at the edge, never stored converted,
// so switching units any number of times cannot drift the geometry.

import { MM_PER_INCH } from "./units";

export type MeasurementUnit = "mm" | "cm" | "in";
export const MEASUREMENT_UNITS: MeasurementUnit[] = ["mm", "cm", "in"];

export const UNIT_LABEL: Record<MeasurementUnit, string> = {
  mm: "Millimeters (mm)",
  cm: "Centimeters (cm)",
  in: "Inches (in)",
};

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

/** "3.00 mm", "0.300 cm", "0.118 in". `decimals` overrides the unit's default. */
export function formatMeasurement(mm: number, unit: MeasurementUnit, decimals = UNIT_DECIMALS[unit]) {
  return `${convertFromCanonical(mm, unit).toFixed(decimals)} ${unit}`;
}

/** Like [`formatMeasurement`] without the unit suffix. */
export const formatValue = (mm: number, unit: MeasurementUnit, decimals = UNIT_DECIMALS[unit]) =>
  convertFromCanonical(mm, unit).toFixed(decimals);
