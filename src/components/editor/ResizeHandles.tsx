import { HANDLES, type Handle } from "../../lib/selection";
import type { Rect } from "../../lib/coordinates";

const SIZE = 9; // screen px, constant regardless of zoom

const POS: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};
const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

/** `screen` is the selection in screen px. */
export function ResizeHandles({ screen }: { screen: Rect }) {
  return (
    <>
      {HANDLES.map((h) => (
        <rect
          key={h}
          data-hit={h}
          x={screen.x + POS[h][0] * screen.width - SIZE / 2}
          y={screen.y + POS[h][1] * screen.height - SIZE / 2}
          width={SIZE}
          height={SIZE}
          fill="#fff"
          stroke="var(--accent)"
          strokeWidth={1.5}
          style={{ cursor: CURSOR[h] }}
        />
      ))}
    </>
  );
}
