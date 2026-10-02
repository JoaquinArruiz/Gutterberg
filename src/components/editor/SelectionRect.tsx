import type { Rect } from "../../lib/coordinates";
import { ResizeHandles } from "./ResizeHandles";

/** Selection rectangle + handles, drawn in screen px. Hit targets carry `data-hit`. */
export function SelectionRect({ screen, movable }: { screen: Rect; movable: boolean }) {
  return (
    <g>
      <rect
        data-hit="body"
        x={screen.x}
        y={screen.y}
        width={screen.width}
        height={screen.height}
        fill="var(--accent)"
        fillOpacity={0.12}
        stroke="var(--accent)"
        strokeWidth={1.5}
        style={{ cursor: movable ? "move" : "inherit" }}
      />
      {movable && <ResizeHandles screen={screen} />}
    </g>
  );
}
