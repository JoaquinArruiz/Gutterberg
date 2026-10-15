// Guides on the page canvas (0.15.0): each drawn across the whole canvas, with a wider invisible line to grab it by,
// and the guide being dragged with its distance from the page's corner. The canvas does the dragging.

import { documentToScreen, guidesToNormalized, type ViewportState } from "../../lib/coordinates";
import { GUIDE_GRAB_PX, type GuideAxis, type GuideSet } from "../../lib/guides";
import { formatMeasurement, type MeasurementUnit } from "../../lib/measurement";
import type { PageSize } from "../../lib/tauri";
import { ptToMm } from "../../lib/units";

/** A guide being dragged: `index` null for a new one; `onRuler` when it would be deleted if let go. */
export type GuideDrag = { axis: GuideAxis; index: number | null; pt: number; onRuler: boolean };

const GUIDE_COLOR = "#06b6d4";

export function GuideLines({
  guides,
  dragging,
  viewport,
  page,
  box,
  grabbable,
  unit,
}: {
  guides: GuideSet;
  dragging: GuideDrag | null;
  viewport: ViewportState;
  page: PageSize;
  box: { width: number; height: number };
  grabbable: boolean;
  unit: MeasurementUnit;
}) {
  /** The screen position across `axis` of a guide at `pt`. */
  const screen = (axis: GuideAxis, pt: number) => {
    const n = guidesToNormalized(axis === "x" ? { xs: [pt], ys: [] } : { xs: [], ys: [pt] }, page);
    const p = documentToScreen({ x: n.xs[0] ?? 0, y: n.ys[0] ?? 0 }, viewport, page);
    return axis === "x" ? p.x : p.y;
  };
  const line = (axis: GuideAxis, at: number) =>
    axis === "x" ? { x1: at, x2: at, y1: 0, y2: box.height } : { x1: 0, x2: box.width, y1: at, y2: at };
  const all: { axis: GuideAxis; index: number; pt: number }[] = [
    ...guides.xs.map((pt, index) => ({ axis: "x" as const, index, pt })),
    ...guides.ys.map((pt, index) => ({ axis: "y" as const, index, pt })),
  ];
  return (
    <g data-testid="guides">
      {all.map(({ axis, index, pt }) => {
        // The one being moved is drawn where the pointer is instead.
        if (dragging?.axis === axis && dragging.index === index) return null;
        const at = screen(axis, pt);
        return (
          <g key={`${axis}${index}`}>
            <line {...line(axis, at)} stroke={GUIDE_COLOR} strokeWidth={1} pointerEvents="none" />
            {grabbable && (
              <line
                {...line(axis, at)}
                data-hit="guide"
                data-axis={axis}
                data-index={index}
                stroke="transparent"
                strokeWidth={GUIDE_GRAB_PX * 2 + 1}
                style={{ cursor: axis === "x" ? "col-resize" : "row-resize" }}
              />
            )}
          </g>
        );
      })}
      {dragging && <DraggedGuide drag={dragging} at={screen(dragging.axis, dragging.pt)} line={line} unit={unit} />}
    </g>
  );
}

function DraggedGuide({
  drag,
  at,
  line,
  unit,
}: {
  drag: GuideDrag;
  at: number;
  line: (axis: GuideAxis, at: number) => { x1: number; x2: number; y1: number; y2: number };
  unit: MeasurementUnit;
}) {
  const text = formatMeasurement(ptToMm(drag.pt), unit);
  const [x, y] = drag.axis === "x" ? [at + 6, 16] : [6, at - 6];
  return (
    <g pointerEvents="none" opacity={drag.onRuler ? 0.4 : 1} data-testid="guide-drag">
      <line {...line(drag.axis, at)} stroke={GUIDE_COLOR} strokeWidth={1} strokeDasharray="4 3" />
      {!drag.onRuler && (
        <text x={x} y={y} fontSize={11} fill={GUIDE_COLOR} stroke="var(--canvas)" strokeWidth={3} paintOrder="stroke">
          {text}
        </text>
      )}
    </g>
  );
}
