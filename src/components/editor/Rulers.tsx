// The rulers along the top and the left of the page canvas (0.15.0): ticks in the user's unit, measured from the
// page's top-left corner, and a mark that follows the pointer. The maths is in lib/rulers.ts; this only draws it.
// The pointer mark moves without a React render: the canvas calls `mark` on every pointer move. Pressing on a ruler
// drags out a guide; the canvas handles that drag, through the pointer handlers it passes in.

import { type Ref, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MeasurementUnit } from "../../lib/measurement";
import { RULER_PX, rulerTicks, type TickSize } from "../../lib/rulers";
import { menuItem, Popover } from "../workspace/Popover";

/** Lets the canvas move the pointer mark: a position along the ruler (screen px), or null to hide it. */
export type RulerHandle = { mark: (px: number | null) => void };

const TICK_PX: Record<TickSize, number> = { major: 10, middle: 6, minor: 3 };

export function Ruler({
  axis,
  lengthPx,
  originPx,
  pxPerMm,
  unit,
  ref,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  /** "x": the top ruler, along the page's width; "y": the left one. */
  axis: "x" | "y";
  lengthPx: number;
  /** Where the page's corner is along the ruler (screen px). */
  originPx: number;
  pxPerMm: number;
  unit: MeasurementUnit;
  ref?: Ref<RulerHandle>;
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void;
}) {
  const markLine = useRef<SVGLineElement>(null);
  useImperativeHandle(ref, () => ({
    mark: (px) => {
      const el = markLine.current;
      if (!el) return;
      el.style.display = px === null ? "none" : "";
      if (px !== null) el.setAttribute("transform", axis === "x" ? `translate(${px} 0)` : `translate(0 ${px})`);
    },
  }));
  const ticks = rulerTicks(unit, pxPerMm, originPx, lengthPx);
  const horizontal = axis === "x";
  // Ticks grow from the edge next to the page.
  const tick = (px: number, size: TickSize) =>
    horizontal
      ? { x1: px, x2: px, y1: RULER_PX, y2: RULER_PX - TICK_PX[size] }
      : { x1: RULER_PX, x2: RULER_PX - TICK_PX[size], y1: px, y2: px };
  return (
    <svg
      aria-hidden
      data-testid={`ruler-${axis}`}
      className={`shrink-0 select-none bg-[var(--panel)] ${horizontal ? "border-b" : "border-r"} border-[var(--border)]`}
      width={horizontal ? lengthPx : RULER_PX}
      height={horizontal ? RULER_PX : lengthPx}
      style={{ cursor: horizontal ? "row-resize" : "col-resize", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {ticks.map((t) => (
        <g key={t.px}>
          <line {...tick(t.px, t.size)} stroke="var(--muted)" strokeWidth={1} shapeRendering="crispEdges" />
          {t.label !== null && (
            <text
              x={horizontal ? t.px + 2 : 9}
              y={horizontal ? 9 : t.px - 2}
              transform={horizontal ? undefined : `rotate(-90 9 ${t.px - 2})`}
              fontSize={9}
              fill="var(--muted)"
            >
              {t.label}
            </text>
          )}
        </g>
      ))}
      <line
        ref={markLine}
        data-testid={`ruler-${axis}-mark`}
        style={{ display: "none" }}
        {...(horizontal ? { x1: 0, x2: 0, y1: 0, y2: RULER_PX } : { x1: 0, x2: RULER_PX, y1: 0, y2: 0 })}
        stroke="var(--accent)"
        strokeWidth={1}
      />
    </svg>
  );
}

/** The square where the two rulers meet: a small menu for the guides. */
export function RulerCorner({ hasGuides, onClear }: { hasGuides: boolean; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 border-r border-b border-[var(--border)] bg-[var(--panel)]"
      style={{ width: RULER_PX, height: RULER_PX }}
    >
      <Popover
        label={t("viewport.guidesMenu")}
        align="left"
        testId="ruler-corner"
        trigger={<span aria-hidden className="block size-1.5 rounded-full bg-[var(--muted)]" />}
        triggerClassName="flex size-[17px] items-center justify-center hover:bg-[var(--hover)]"
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={!hasGuides}
              onClick={() => {
                onClear();
                close();
              }}
            >
              {t("viewport.clearGuides")}
            </button>
            <p className="max-w-60 px-2 py-1 text-xs text-[var(--muted)]">{t("viewport.noGuides")}</p>
          </>
        )}
      </Popover>
    </div>
  );
}
