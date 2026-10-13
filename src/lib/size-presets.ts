// Piece size presets: one list of sizes shared by the Print tab's Selected pieces and the "Add images" dialog, and
// the sizes a user saves. A preset sets an explicit, visible real size (the rule in AGENTS.md); it may fix only the
// width or only the height, keeping the piece's proportions.

import { scaleForSize } from "./card-edits";

/** The sizes people sleeve their cards in, in mm (width × height). */
export const BUILT_IN_SIZES = [
  { id: "poker", widthMm: 63.5, heightMm: 88.9 },
  { id: "standard", widthMm: 63, heightMm: 88 },
  { id: "miniAmerican", widthMm: 41, heightMm: 63 },
  { id: "miniEuropean", widthMm: 44, heightMm: 68 },
  { id: "european", widthMm: 59, heightMm: 92 },
  { id: "japanese", widthMm: 59, heightMm: 86 },
  { id: "square", widthMm: 70, heightMm: 70 },
  { id: "tarot", widthMm: 70, heightMm: 120 },
] as const;

export type BuiltInSizeId = (typeof BUILT_IN_SIZES)[number]["id"];
export const BUILT_IN_SIZE_IDS = BUILT_IN_SIZES.map((s) => s.id) as readonly BuiltInSizeId[];

export const builtInSize = (id: BuiltInSizeId) => {
  const size = BUILT_IN_SIZES.find((s) => s.id === id);
  if (!size) throw new Error(`unknown size preset ${id}`);
  return size;
};

/** A size the user saved. A side that is null is left as it is: a preset may fix only the width or only the height. */
export type UserSizePreset = { name: string; widthMm: number | null; heightMm: number | null };

export const MAX_SIZE_PRESETS = 50;
export const MAX_SIZE_PRESET_NAME = 60;
export const SIZE_RANGE_MM = [5, 1000] as const;

const clampMm = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, SIZE_RANGE_MM[0]), SIZE_RANGE_MM[1]) : null;

/** Raw (possibly stale or hand-edited) saved presets -> valid ones: named, unique, with at least one side, capped. */
export function normalizeSizePresets(raw: unknown): UserSizePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: UserSizePreset[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null || typeof (p as { name?: unknown }).name !== "string") continue;
    const { name: rawName, widthMm, heightMm } = p as { name: string; widthMm?: unknown; heightMm?: unknown };
    const name = rawName.trim().slice(0, MAX_SIZE_PRESET_NAME);
    const [w, h] = [clampMm(widthMm), clampMm(heightMm)];
    if (!name || (w === null && h === null) || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, widthMm: w, heightMm: h });
    if (out.length >= MAX_SIZE_PRESETS) break;
  }
  return out;
}

/**
 * The scales that give a piece (from its unscaled source size) the size of a preset. A preset with both sides sets
 * each (a piece of other proportions is stretched); with one side, the other follows, so the proportions stay.
 */
export function presetScales(
  source: { width: number; height: number },
  size: { widthMm: number | null; heightMm: number | null },
): { x: number; y: number } {
  const [w, h] = [size.widthMm, size.heightMm];
  if (w !== null && h !== null) return { x: scaleForSize(source, "width", w), y: scaleForSize(source, "height", h) };
  const s = w !== null ? scaleForSize(source, "width", w) : scaleForSize(source, "height", h ?? 0);
  return { x: s, y: s };
}

/** Whether a preset with both sides would stretch a piece (its proportions differ by more than 1%). */
export function stretches(
  source: { width: number; height: number },
  size: { widthMm: number | null; heightMm: number | null },
): boolean {
  if (size.widthMm === null || size.heightMm === null) return false;
  return Math.abs(source.width / source.height / (size.widthMm / size.heightMm) - 1) > 0.01;
}
