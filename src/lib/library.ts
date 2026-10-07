// The card library: which cards are shown, which are selected and how many copies each gets.
// Pure functions over plain data, so the panel stays a thin view.

import { cardIdKey } from "./card";
import type { PageGroup } from "./document-layout";
import { MAX_QUANTITY } from "./print-request";
import type { Card } from "./sheet-api";

/** All cards, the cards of one grid group (an index into the page groups), or the cards of one page. */
export type LibraryFilter = { kind: "all" } | { kind: "group"; index: number } | { kind: "page"; page: number };

export function filterCards(cards: Card[], groups: PageGroup[], filter: LibraryFilter): Card[] {
  if (filter.kind === "all") return cards;
  if (filter.kind === "page") return cards.filter((c) => c.id.page_index === filter.page);
  const g = groups[filter.index];
  if (!g) return [];
  return cards.filter((c) => c.id.page_index >= g.pages.first && c.id.page_index <= g.pages.last);
}

export type Selection = { selected: string[]; anchor: string | null };
export const EMPTY_SELECTION: Selection = { selected: [], anchor: null };

/**
 * A click on card `key`: alone it selects just that card, with Ctrl/Cmd it toggles it, with Shift it
 * selects every card from the last clicked one to this one (in the order shown, `visible`).
 */
export function clickCard(
  sel: Selection,
  key: string,
  visible: string[],
  modifier: "none" | "toggle" | "range",
): Selection {
  if (modifier === "toggle") {
    const has = sel.selected.includes(key);
    return { selected: has ? sel.selected.filter((k) => k !== key) : [...sel.selected, key], anchor: key };
  }
  if (modifier === "range" && sel.anchor !== null) {
    const a = visible.indexOf(sel.anchor);
    const b = visible.indexOf(key);
    if (a !== -1 && b !== -1)
      return { selected: visible.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: sel.anchor };
  }
  return { selected: [key], anchor: key };
}

/** Keeps only selected cards that still exist. */
export function pruneSelection(sel: Selection, existing: Set<string>): Selection {
  const selected = sel.selected.filter((k) => existing.has(k));
  return selected.length === sel.selected.length
    ? sel
    : { selected, anchor: sel.anchor && existing.has(sel.anchor) ? sel.anchor : null };
}

export const clampQuantity = (n: number) => Math.min(Math.max(Math.round(Number.isFinite(n) ? n : 0), 0), MAX_QUANTITY);

/** Quantities with `keys` set to `n` (0 removes the entry). */
export function setQuantity(quantities: Record<string, number>, keys: string[], n: number): Record<string, number> {
  const q = clampQuantity(n);
  const next = { ...quantities };
  for (const k of keys) {
    if (q === 0) delete next[k];
    else next[k] = q;
  }
  return next;
}

/** Quantities with each of `keys` moved by `delta` (never below 0 or above the maximum). */
export function adjustQuantity(quantities: Record<string, number>, keys: string[], delta: number) {
  const next = { ...quantities };
  for (const k of keys) {
    const q = clampQuantity((next[k] ?? 0) + delta);
    if (q === 0) delete next[k];
    else next[k] = q;
  }
  return next;
}

/** The one quantity shared by every key, or null when they differ (or there are none). */
export function commonQuantity(quantities: Record<string, number>, keys: string[]): number | null {
  if (keys.length === 0) return null;
  const first = quantities[keys[0]] ?? 0;
  return keys.every((k) => (quantities[k] ?? 0) === first) ? first : null;
}

/** Quantity 1 for every card: what "all cards in order" means, as a starting point for a custom selection. */
export function oneOfEach(cards: Card[]): Record<string, number> {
  return Object.fromEntries(cards.map((c) => [cardIdKey(c.id), 1]));
}
