// The rulers along the top and the left of the page canvas (0.15.0): where their ticks go and which carry a number.
// They measure from the page's top-left corner in the user's unit. The step follows the zoom: the smallest of a fixed
// list whose ticks stay a readable distance apart on screen, with numbers on the larger ones. Pure: screen pixels in,
// ticks out; the component only draws them.

import type { MeasurementUnit } from "./measurement";
import { MM_PER_INCH } from "./units";

/** The ruler's thickness (screen px). */
export const RULER_PX = 18;
/** Ticks closer than this (screen px) are too dense to read. */
export const MIN_TICK_PX = 6;
/** Numbers closer than this (screen px) run into each other. */
export const MIN_LABEL_PX = 40;

/** Tick steps (mm) to choose from: metric, and fractions of an inch. */
const METRIC_STEPS_MM = [1, 5, 10, 50];
const INCH_STEPS_MM = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1].map((i) => i * MM_PER_INCH);
/** Steps (mm) between numbers: whole units of what is shown, so a number never has decimals. */
const METRIC_LABELS_MM = [10, 50, 100, 500, 1000];
const INCH_LABELS_MM = [1, 2, 5, 10, 20].map((i) => i * MM_PER_INCH);

export type TickSize = "major" | "middle" | "minor";

export type Tick = {
  /** Screen px along the ruler, from its start. */
  px: number;
  size: TickSize;
  /** The number shown at a major tick, in the unit; null elsewhere. */
  label: string | null;
};

/** The tick step and the step between numbers (both mm) at `pxPerMm` screen pixels per millimetre. */
export function rulerSteps(unit: MeasurementUnit, pxPerMm: number): { tickMm: number; labelMm: number } {
  const steps = unit === "in" ? INCH_STEPS_MM : METRIC_STEPS_MM;
  const labels = unit === "in" ? INCH_LABELS_MM : METRIC_LABELS_MM;
  const tickMm = steps.find((s) => s * pxPerMm >= MIN_TICK_PX) ?? steps[steps.length - 1];
  const labelMm = labels.find((s) => s * pxPerMm >= MIN_LABEL_PX && s >= tickMm) ?? labels[labels.length - 1];
  return { tickMm, labelMm };
}

/** `mm` in the unit, as the whole number a ruler shows. */
function label(mm: number, unit: MeasurementUnit): string {
  const perUnit = unit === "in" ? MM_PER_INCH : unit === "cm" ? 10 : 1;
  return String(Math.round(mm / perUnit));
}

/**
 * The ticks of a ruler `lengthPx` long whose page corner (0) is at `originPx` along it, at `pxPerMm`. Ticks before
 * the corner count down from it (negative numbers), so the ruler reads the same wherever the page is panned.
 */
export function rulerTicks(unit: MeasurementUnit, pxPerMm: number, originPx: number, lengthPx: number): Tick[] {
  if (!(pxPerMm > 0) || lengthPx <= 0) return [];
  const { tickMm, labelMm } = rulerSteps(unit, pxPerMm);
  const first = Math.ceil(-originPx / pxPerMm / tickMm);
  const last = Math.floor((lengthPx - originPx) / pxPerMm / tickMm);
  // Whole multiples, counted in ticks, so that no rounding of the millimetres creeps in.
  const perLabel = Math.round(labelMm / tickMm);
  // A middle tick halfway between two numbers, when there are ticks between it and them.
  const perMiddle = perLabel % 2 === 0 && perLabel >= 4 ? perLabel / 2 : 0;
  const ticks: Tick[] = [];
  for (let i = first; i <= last; i++) {
    const mm = i * tickMm;
    const major = i % perLabel === 0;
    const size: TickSize = major ? "major" : perMiddle > 0 && i % perMiddle === 0 ? "middle" : "minor";
    ticks.push({ px: originPx + mm * pxPerMm, size, label: major ? label(mm, unit) : null });
  }
  return ticks;
}
