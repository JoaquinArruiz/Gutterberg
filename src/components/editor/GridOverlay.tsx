import { type NormalizedRect, rectToScreen, type ViewportState } from "../../lib/coordinates";
import { cardRects, type GridSpec, hasCrop, pieceRects } from "../../lib/grid";
import type { PageSize } from "../../lib/tauri";

const MIN_LABEL_PX = 28;

/** Card boundaries (and numbers) inside the selection, in the grid's colour. Pointer-transparent. */
export function GridOverlay({
  selection,
  grid,
  viewport,
  page,
  color = "var(--accent)",
}: {
  selection: NormalizedRect;
  grid: GridSpec;
  viewport: ViewportState;
  page: PageSize;
  color?: string;
}) {
  const cards = cardRects(selection, grid, page).map((r) => rectToScreen(r, viewport, page));
  // Source gaps = selection minus the cards (even-odd), so existing spacing is visible.
  const sel = rectToScreen(selection, viewport, page);
  const hasGap = (grid.gapXMm ?? 0) > 0 || (grid.gapYMm ?? 0) > 0;
  const box = (r: { x: number; y: number; width: number; height: number }) =>
    `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}z`;
  // A crop: the band cut off each piece is shaded, and the piece that prints is outlined inside its cell.
  const pieces = hasCrop(grid.crop)
    ? pieceRects(selection, grid, page).map((r) => rectToScreen(r, viewport, page))
    : [];
  return (
    <g pointerEvents="none">
      {hasGap && <path d={[sel, ...cards].map(box).join("")} fillRule="evenodd" fill="#a855f7" fillOpacity={0.28} />}
      {pieces.length > 0 && (
        <path
          data-testid="crop-band"
          d={[...cards, ...pieces].map(box).join("")}
          fillRule="evenodd"
          fill="#f59e0b"
          fillOpacity={0.35}
        />
      )}
      {pieces.map((p) => (
        <rect
          key={`piece-${p.x}-${p.y}`}
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeOpacity={0.9}
        />
      ))}
      {cards.map((c, i) => (
        <g key={`${c.x}-${c.y}`}>
          <rect
            x={c.x}
            y={c.y}
            width={c.width}
            height={c.height}
            fill="none"
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeOpacity={0.9}
          />
          {c.width > MIN_LABEL_PX && c.height > MIN_LABEL_PX && (
            <text
              x={c.x + c.width / 2}
              y={c.y + c.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(22, c.height / 3)}
              fill="#fff"
              stroke="#000"
              strokeWidth={3}
              paintOrder="stroke"
              opacity={0.85}
            >
              {i + 1}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
