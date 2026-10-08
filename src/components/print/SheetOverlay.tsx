import type { OutputSheet } from "../../lib/sheet-api";
import { mmToPt } from "../../lib/units";

/**
 * What the sheet adds around the pieces: the cut marks (drawn as the engine placed them) and, when there is
 * a bleed, a dashed frame around each piece showing how far it reaches. The mirrored art of the bleed is not
 * drawn here; the exported file has it. `k` is screen px per point.
 */
export function SheetOverlay({ sheet, k }: { sheet: OutputSheet; k: number }) {
  const bleed = mmToPt(sheet.bleed?.mm ?? 0);
  const marks = sheet.marks;
  if (bleed <= 0 && !marks) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={sheet.page.width_pt * k}
      height={sheet.page.height_pt * k}
      data-testid="sheet-overlay"
      aria-hidden
    >
      {bleed > 0 &&
        sheet.placements.map((p, i) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: a card can appear many times on a sheet; its slot is its identity
            key={i}
            data-testid="bleed-frame"
            x={(p.destination.x - bleed) * k}
            y={(p.destination.y - bleed) * k}
            width={(p.destination.width + 2 * bleed) * k}
            height={(p.destination.height + 2 * bleed) * k}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        ))}
      {marks?.lines.map(([x1, y1, x2, y2], i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: marks have no id; their position is their identity
          key={i}
          data-testid="cut-mark"
          x1={x1 * k}
          y1={y1 * k}
          x2={x2 * k}
          y2={y2 * k}
          stroke={`rgb(${marks.color.join(",")})`}
          strokeWidth={Math.max(1, marks.width_pt * k)}
        />
      ))}
    </svg>
  );
}
