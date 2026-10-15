import type { Rect } from "../../lib/coordinates";
import { ResizeHandles } from "./ResizeHandles";

/**
 * Selection rectangle + handles, drawn in screen px. Hit targets carry `data-hit`. `picked`: the arrow keys move it,
 * so it is drawn a little stronger. `resizable` false leaves the handles out (a picked folder moves, it does not
 * resize).
 */
export function SelectionRect({
  screen,
  movable,
  picked = false,
  resizable = true,
  color = "var(--accent)",
}: {
  screen: Rect;
  movable: boolean;
  picked?: boolean;
  resizable?: boolean;
  color?: string;
}) {
  return (
    <g>
      <rect
        data-hit="body"
        x={screen.x}
        y={screen.y}
        width={screen.width}
        height={screen.height}
        fill={color}
        data-picked={picked || undefined}
        fillOpacity={picked ? 0.16 : 0.12}
        stroke={color}
        strokeWidth={picked ? 2 : 1.5}
        style={{ cursor: movable ? "move" : "inherit" }}
      />
      {movable && resizable && <ResizeHandles screen={screen} />}
    </g>
  );
}
