// Guides (0.15.0): lines dragged out of the rulers that the grid region and the pieces snap to. They are kept per PDF
// for the session (the same guides on every page of it), in points from the page's top-left corner, so a guide stays
// at the same distance from the corner on pages of different sizes. Not saved in the project and not part of undo.

/** "x": a vertical guide, at an x (dragged from the left ruler); "y": a horizontal one, at a y (from the top ruler). */
export type GuideAxis = "x" | "y";
/** The guides of one PDF: `xs` vertical, `ys` horizontal, in points from the page's top-left corner. */
export type GuideSet = { xs: number[]; ys: number[] };

export const NO_GUIDE_SET: GuideSet = { xs: [], ys: [] };

/** Pressing this close (screen px) to a guide, either side, grabs it. */
export const GUIDE_GRAB_PX = 4;

const key = (axis: GuideAxis) => (axis === "x" ? "xs" : "ys");

export const addGuide = (set: GuideSet, axis: GuideAxis, pt: number): GuideSet => ({
  ...set,
  [key(axis)]: [...set[key(axis)], pt],
});

export const moveGuide = (set: GuideSet, axis: GuideAxis, index: number, pt: number): GuideSet => ({
  ...set,
  [key(axis)]: set[key(axis)].map((v, i) => (i === index ? pt : v)),
});

export const removeGuide = (set: GuideSet, axis: GuideAxis, index: number): GuideSet => ({
  ...set,
  [key(axis)]: set[key(axis)].filter((_, i) => i !== index),
});

/** Where a ruler is: along the top of the canvas or down its left side. */
export type RulerSide = "top" | "left";

/**
 * The ruler a guide comes from and goes back to. Normally the top ruler gives horizontal guides and the left one
 * vertical guides, each parallel to its ruler; "Invert rulers" (a preference) swaps them, so each ruler gives the
 * guide perpendicular to it.
 */
export const rulerOf = (axis: GuideAxis, inverted: boolean): RulerSide =>
  (axis === "y") !== inverted ? "top" : "left";

/** The guide a ruler gives: the other way round from [`rulerOf`]. */
export const guideFrom = (ruler: RulerSide, inverted: boolean): GuideAxis =>
  (ruler === "top") !== inverted ? "y" : "x";

/** Whether `p` (canvas px, the canvas's top-left at 0) is over `ruler`: above the canvas, or left of it. */
export const overRuler = (ruler: RulerSide, p: { x: number; y: number }) => (ruler === "top" ? p.y < 0 : p.x < 0);

/** What a guide drag leaves: the guide made, moved or deleted. `index` is null for a new guide. */
export function dropGuide(
  set: GuideSet,
  axis: GuideAxis,
  index: number | null,
  pt: number,
  onRuler: boolean,
): GuideSet {
  if (onRuler) return index === null ? set : removeGuide(set, axis, index);
  return index === null ? addGuide(set, axis, pt) : moveGuide(set, axis, index, pt);
}
