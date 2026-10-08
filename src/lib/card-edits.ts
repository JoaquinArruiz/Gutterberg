// What the user decided about individual cards in the Print stage's library (M18): which way each
// faces (turn), what real size it prints at (scale) and where it sits in the order. Plain data keyed
// by `cardIdKey`, with pure functions over it; the layout store holds it so undo covers it.
//
// Copies (quantities) are part of the plan, not of this: see `print-request.ts`.

import { cardIdKey } from "./card";
import { formatDecimal, formatValue, type MeasurementUnit } from "./measurement";
import type { Card, Turn } from "./sheet-api";
import { ptToMm } from "./units";

export type CardEdits = {
  /** Output turn per card; a missing entry is 0. */
  turns: Record<string, Turn>;
  /** Scale per card (1 = the size on the source page); a missing entry is 1. */
  scales: Record<string, number>;
  /** The library order as card keys. Empty = page order. Cards it does not list follow, in page order. */
  order: string[];
};

/** Whether a card key (`cardIdKey`) belongs to the PDF `documentId`. */
export const isCardOfDocument = (k: string, documentId: number): boolean => k.split(":")[1] === String(documentId);

export const NO_EDITS: CardEdits = { turns: {}, scales: {}, order: [] };

/** A card can be printed from a tenth of its size up to five times it. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;
export const clampScale = (s: number) => Math.min(Math.max(Number.isFinite(s) ? s : 1, MIN_SCALE), MAX_SCALE);

const key = (c: Card) => cardIdKey(c.id);
const isOne = (s: number) => Math.abs(s - 1) < 1e-6;

/** The cards as the library shows and the planner prints them: in the user's order, with turn and scale applied. */
export function applyEdits(cards: Card[], edits: CardEdits): Card[] {
  const merged = cards.map((c) => {
    const k = key(c);
    const turn = edits.turns[k] ?? c.turn;
    const scale = edits.scales[k] ?? c.scale;
    return turn === c.turn && scale === c.scale ? c : { ...c, turn, scale };
  });
  if (edits.order.length === 0) return merged;
  const rank = new Map(edits.order.map((k, i) => [k, i]));
  const listed = merged
    .filter((c) => rank.has(key(c)))
    .sort((a, b) => (rank.get(key(a)) ?? 0) - (rank.get(key(b)) ?? 0));
  return [...listed, ...merged.filter((c) => !rank.has(key(c)))];
}

/** Whether any card is turned, scaled or moved from its page position: such plans cannot use "same as source". */
export function hasCardEdits(cards: Card[], edits: CardEdits): boolean {
  const natural = cards.map(key);
  if (natural.some((k) => (edits.turns[k] ?? 0) !== 0 || !isOne(edits.scales[k] ?? 1))) return true;
  return applyEdits(cards, edits).some((c, i) => key(c) !== natural[i]);
}

const turned = (turn: Turn, delta: number) => ((((turn + delta) % 360) + 360) % 360) as Turn;

function withTurn(edits: CardEdits, k: string, turn: Turn): CardEdits {
  const turns = { ...edits.turns };
  if (turn === 0) delete turns[k];
  else turns[k] = turn;
  return { ...edits, turns };
}

/** Turn each of `keys` by `delta` degrees (a multiple of 90, clockwise). `cards` are the effective cards. */
export function turnCards(edits: CardEdits, cards: Card[], keys: string[], delta: number): CardEdits {
  let next = edits;
  for (const c of cards) if (keys.includes(key(c))) next = withTurn(next, key(c), turned(c.turn, delta));
  return next;
}

/** The size a card prints at, in points, after its turn and scale. */
export const finalSizePt = (c: Card): { width: number; height: number } => {
  const [w, h] = [c.source.width * c.scale, c.source.height * c.scale];
  return c.turn === 90 || c.turn === 270 ? { width: h, height: w } : { width: w, height: h };
};

/**
 * Make each of `keys` portrait or landscape by a quarter turn where it is not already (squares are left
 * alone). A card turned a quarter is turned back rather than on, so it ends up facing as the page has it.
 */
export function orientCards(edits: CardEdits, cards: Card[], keys: string[], to: "portrait" | "landscape"): CardEdits {
  let next = edits;
  for (const c of cards) {
    if (!keys.includes(key(c))) continue;
    const { width, height } = finalSizePt(c);
    const wrong = to === "portrait" ? width > height + 0.5 : height > width + 0.5;
    if (wrong) next = withTurn(next, key(c), turned(c.turn, c.turn === 90 ? -90 : 90));
  }
  return next;
}

/** Set the scale of each of `keys`; 1 clears it. */
export function scaleCards(edits: CardEdits, keys: string[], scale: number): CardEdits {
  const s = clampScale(scale);
  const scales = { ...edits.scales };
  for (const k of keys) {
    if (isOne(s)) delete scales[k];
    else scales[k] = s;
  }
  return { ...edits, scales };
}

/**
 * Move `keys` (kept in their current relative order) to just before `targetKey`, or just after it.
 * `cards` are the effective cards, whose order is the one being changed. Dropping onto a moved card
 * changes nothing.
 */
export function moveCards(
  edits: CardEdits,
  cards: Card[],
  keys: string[],
  targetKey: string,
  after: boolean,
): CardEdits {
  if (keys.includes(targetKey)) return edits;
  const all = cards.map(key);
  if (!all.includes(targetKey)) return edits;
  const moved = all.filter((k) => keys.includes(k));
  const rest = all.filter((k) => !keys.includes(k));
  const at = rest.indexOf(targetKey) + (after ? 1 : 0);
  return { ...edits, order: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
}

/** The scale that gives a card (from its unscaled source size) a real size of `mm` along one side. */
export function scaleForSize(source: { width: number; height: number }, side: "width" | "height", mm: number): number {
  return clampScale(mm / ptToMm(source[side]));
}

/** "63.0 × 88.0 mm (98.4%)": a card's size as printed, and the scale behind it. */
export function formatCardSize(c: Card, unit: MeasurementUnit): string {
  const { width, height } = finalSizePt(c);
  const decimals = unit === "mm" ? 1 : 2;
  return `${formatValue(ptToMm(width), unit, decimals)} × ${formatValue(ptToMm(height), unit, decimals)} ${unit} (${formatDecimal(c.scale * 100, 1)}%)`;
}

const FREEFORM = /^f:(\d+):(\d+):(\d+)$/;

/**
 * Keys after the freeform card `index` of `page` of document `documentId` is deleted: its own entry goes
 * and the cards after it move up one place, because a freeform card's identity is its position on the page.
 */
export function keyAfterDelete(k: string, documentId: number, page: number, index: number): string | null {
  const m = FREEFORM.exec(k);
  if (!m || Number(m[1]) !== documentId || Number(m[2]) !== page) return k;
  const i = Number(m[3]);
  if (i === index) return null;
  return i > index ? `f:${m[1]}:${m[2]}:${i - 1}` : k;
}

/** `rec` with the entries of a deleted freeform card dropped and the later ones renumbered. */
export function remapRecord<T>(
  rec: Record<string, T>,
  documentId: number,
  page: number,
  index: number,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    const nk = keyAfterDelete(k, documentId, page, index);
    if (nk !== null) out[nk] = v;
  }
  return out;
}

/** The card edits after the freeform card `index` of `page` of document `documentId` is deleted. */
export function editsAfterDelete(edits: CardEdits, documentId: number, page: number, index: number): CardEdits {
  return {
    turns: remapRecord(edits.turns, documentId, page, index),
    scales: remapRecord(edits.scales, documentId, page, index),
    order: edits.order.flatMap((k) => keyAfterDelete(k, documentId, page, index) ?? []),
  };
}
