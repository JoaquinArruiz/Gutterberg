import { rectToScreen, type NormalizedRect, type ViewportState } from "../../lib/coordinates";
import { cardRects, type GridSpec } from "../../lib/grid";
import type { PageSize } from "../../lib/tauri";

const MIN_LABEL_PX = 28;

/** Card boundaries (and numbers) inside the selection. Pointer-transparent. */
export function GridOverlay({
  selection, grid, viewport, page,
}: {
  selection: NormalizedRect;
  grid: GridSpec;
  viewport: ViewportState;
  page: PageSize;
}) {
  const cards = cardRects(selection, grid).map((r) => rectToScreen(r, viewport, page));
  return (
    <g pointerEvents="none">
      {cards.map((c, i) => (
        <g key={i}>
          <rect
            x={c.x} y={c.y} width={c.width} height={c.height}
            fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.9}
          />
          {c.width > MIN_LABEL_PX && c.height > MIN_LABEL_PX && (
            <text
              x={c.x + c.width / 2} y={c.y + c.height / 2}
              textAnchor="middle" dominantBaseline="central" fontSize={Math.min(22, c.height / 3)}
              fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke" opacity={0.85}
            >
              {i + 1}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
