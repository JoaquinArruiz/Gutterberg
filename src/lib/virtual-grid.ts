// Windowing for a grid of fixed-size cells: only the rows near the viewport are mounted.

/** Cells per row for a container `width` wide, cells at least `cellMin` wide with `gap` between them. */
export function gridColumns(width: number, cellMin: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (cellMin + gap)));
}

/** The width each cell gets when `columns` share `width`, so rows are filled edge to edge. */
export function cellWidth(width: number, columns: number, gap: number): number {
  return Math.max(0, (width - gap * (columns - 1)) / columns);
}

/** Inclusive range of rows to mount for a scroll position; `last < first` when there are none. */
export function visibleRows(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan = 2,
): { first: number; last: number } {
  if (totalRows <= 0 || rowHeight <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan - 1);
  return { first: Math.min(first, totalRows - 1), last };
}

export const rowCount = (items: number, columns: number) => Math.ceil(items / columns);
