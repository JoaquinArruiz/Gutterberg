import { rectToScreen, type ViewportState } from "../../lib/coordinates";
import type { GridGroup } from "../../lib/document-layout";
import type { PageSize } from "../../lib/tauri";
import { GridOverlay } from "./GridOverlay";

/**
 * The grids of the page that are not being edited: their cells drawn dimmer, under the one being edited. With the
 * Grid region tool, pressing one (`data-hit="other-grid"`, `data-grid` its number) picks it; otherwise they let the
 * pointer through.
 */
export function OtherGrids({
  group,
  active,
  viewport,
  page,
  pickable,
}: {
  group: GridGroup;
  active: number;
  viewport: ViewportState;
  page: PageSize;
  pickable: boolean;
}) {
  return (
    <g opacity={0.45} data-testid="other-grids" pointerEvents={pickable ? undefined : "none"}>
      {group.grids.map((r, n) => {
        if (n === active || !r.selection) return null;
        const s = rectToScreen(r.selection, viewport, page);
        const spec = {
          rows: r.grid.rows,
          columns: r.grid.columns,
          gapXMm: r.grid.sourceGapXMm,
          gapYMm: r.grid.sourceGapYMm,
        };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a grid's place on the page is its identity
          <g key={n}>
            <GridOverlay selection={r.selection} grid={spec} viewport={viewport} page={page} />
            <rect
              data-hit="other-grid"
              data-grid={n}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              fill="var(--accent)"
              fillOpacity={0.06}
              stroke="var(--accent)"
              strokeWidth={1}
              style={{ cursor: pickable ? "pointer" : "inherit" }}
            />
          </g>
        );
      })}
    </g>
  );
}
