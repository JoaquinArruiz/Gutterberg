// Copies from a pasted list: one line per piece, in the piece library's order, each with a number of copies.
// Pieces have no names Gutterberg could match, so the order is what pairs a line with a piece; the rest of the line
// ("Ember Drake") is shown beside the piece it lands on, so a list out of step is easy to see before applying.

import { MAX_QUANTITY } from "./print-request";

/** One line of the list that has a number: how many copies, and the line without the number. */
export type CopiesLine = { copies: number; label: string };

/** What a pasted list holds: the lines with a number, and how many lines without one were left out. */
export type CopiesList = { lines: CopiesLine[]; skipped: number };

// "3x Name", "3 × Name", "3 Name", "3"
const LEADING = /^(\d{1,4})\s*(?:[x×*]\b|[x×*](?=\s|$))?\s*[,;:\t-]?\s*(.*)$/i;
// "Name x3", "Name ×3", "Name, 3", "Name;3", "Name\t3", "Name (3)"
const TRAILING = /^(.*?)\s*(?:[,;:\t]|\s[x×*]?|^[x×*]?)\s*\(?(\d{1,4})\)?\s*$/i;

/** Read a pasted list: blank lines and `#` comments are ignored, a line without a number is left out (a header). */
export function parseCopiesList(text: string): CopiesList {
  const lines: CopiesLine[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const lead = LEADING.exec(line);
    const trail = lead ? null : TRAILING.exec(line);
    const number = lead?.[1] ?? trail?.[2];
    if (number === undefined) {
      skipped++;
      continue;
    }
    const label = (lead ? lead[2] : (trail?.[1] ?? "")).replace(/^["']|["']$/g, "").trim();
    lines.push({ copies: Math.min(Number(number), MAX_QUANTITY), label });
  }
  return { lines, skipped };
}

/** The copies each piece gets: the lines in order onto `keys` in order; extra lines or pieces are left alone. */
export function copiesFor(keys: string[], list: CopiesList): Record<string, number> {
  const out: Record<string, number> = {};
  list.lines.forEach((line, i) => {
    if (i < keys.length) out[keys[i]] = line.copies;
  });
  return out;
}
