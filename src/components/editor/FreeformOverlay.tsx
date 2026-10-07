import type { OrientedRect } from "../../lib/card";
import { orientedToScreen, type ViewportState } from "../../lib/coordinates";
import { ROTATE_HANDLE_PX } from "../../lib/freeform";
import type { PageSize } from "../../lib/tauri";
import { ResizeHandles } from "./ResizeHandles";

const MIN_LABEL_PX = 24;

/**
 * The freeform cards of the viewed page, drawn in screen px, each rotated about its own centre. In the
 * card tool (`interactive`) every card can be picked and the selected one has its resize handles and a
 * rotate handle above the top edge; otherwise they are only shown, and never take a pointer event.
 * Hit targets carry `data-hit` and `data-card` (the card's index).
 */
export function FreeformOverlay({
  cards,
  selected,
  viewport,
  page,
  interactive,
}: {
  cards: OrientedRect[];
  selected: number | null;
  viewport: ViewportState;
  page: PageSize;
  interactive: boolean;
}) {
  // The selected card is drawn last, so it is on top and its handles are never covered.
  const order = cards.map((_, i) => i).sort((a, b) => Number(a === selected) - Number(b === selected));
  return (
    <g pointerEvents={interactive ? undefined : "none"} data-testid="freeform-overlay">
      {order.map((i) => {
        const s = orientedToScreen(cards[i], viewport, page);
        const rect = { x: s.center.x - s.width / 2, y: s.center.y - s.height / 2, width: s.width, height: s.height };
        const isSelected = interactive && i === selected;
        return (
          <g key={i} transform={`rotate(${s.angle_deg} ${s.center.x} ${s.center.y})`}>
            <rect
              data-hit="card"
              data-card={i}
              {...rect}
              fill="var(--accent)"
              fillOpacity={isSelected ? 0.16 : 0.08}
              stroke="var(--accent)"
              strokeWidth={isSelected ? 1.5 : 1}
              strokeDasharray={isSelected ? undefined : "5 3"}
              style={{ cursor: interactive ? "move" : "inherit" }}
            />
            {Math.min(s.width, s.height) > MIN_LABEL_PX && (
              <text
                x={s.center.x}
                y={s.center.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(22, s.height / 3)}
                fill="#fff"
                stroke="#000"
                strokeWidth={3}
                paintOrder="stroke"
                opacity={0.85}
                pointerEvents="none"
              >
                {i + 1}
              </text>
            )}
            {isSelected && (
              <>
                <ResizeHandles screen={rect} card={i} />
                <line
                  x1={s.center.x}
                  y1={rect.y}
                  x2={s.center.x}
                  y2={rect.y - ROTATE_HANDLE_PX}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
                <circle
                  data-hit="rotate"
                  data-card={i}
                  cx={s.center.x}
                  cy={rect.y - ROTATE_HANDLE_PX}
                  r={5.5}
                  fill="#fff"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  style={{ cursor: "grab" }}
                />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
