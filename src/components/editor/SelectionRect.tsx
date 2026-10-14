import type { Rect } from "../../lib/coordinates";
import { ResizeHandles } from "./ResizeHandles";

/**
 * Selection rectangle + handles, drawn in screen px. Hit targets carry `data-hit`. `picked`: the arrow keys move it,
 * so it is drawn a little stronger.
 */
export function SelectionRect({
  screen,
  movable,
  picked = false,
}: {
  screen: Rect;
  movable: boolean;
  picked?: boolean;
}) {
  return (
    <g>
      <rect
        data-hit="body"
        x={screen.x}
        y={screen.y}
        width={screen.width}
        height={screen.height}
        fill="var(--accent)"
        data-picked={picked || undefined}
        fillOpacity={picked ? 0.16 : 0.12}
        stroke="var(--accent)"
        strokeWidth={picked ? 2 : 1.5}
        style={{ cursor: movable ? "move" : "inherit" }}
      />
      {movable && <ResizeHandles screen={screen} />}
    </g>
  );
}
