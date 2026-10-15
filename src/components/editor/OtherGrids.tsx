import { useTranslation } from "react-i18next";
import { rectToScreen, type ViewportState } from "../../lib/coordinates";
import type { GridGroup } from "../../lib/document-layout";
import type { PageSize } from "../../lib/tauri";
import { GridOverlay } from "./GridOverlay";

/** Labels narrower than this (screen px) are left out, so a small grid is not covered by its name. */
const MIN_LABEL_WIDTH_PX = 40;

/**
 * The grids of the page that are not being edited: their cells drawn dimmer, under the one being edited, each in its
 * colour; the grids of a picked folder (`folder`) are drawn at full strength, since they move with it. With the Grid
 * region tool, pressing one (`data-hit="other-grid"`, `data-grid` its number) picks it; otherwise they let the pointer
 * through. Every drawn grid, the one being edited too, carries its name above its top-left corner. Hidden grids are
not drawn.
 */
export function OtherGrids({
  group,
  active,
  folder,
  viewport,
  page,
  pickable,
}: {
  group: GridGroup;
  active: number;
  folder: string | null;
  viewport: ViewportState;
  page: PageSize;
  pickable: boolean;
}) {
  const { t } = useTranslation();
  return (
    <g data-testid="other-grids">
      <g pointerEvents={pickable ? undefined : "none"}>
        {group.grids.map((r, n) => {
          if (n === active || !r.selection || r.hidden) return null;
          const s = rectToScreen(r.selection, viewport, page);
          const color = r.color ?? "var(--accent)";
          const spec = {
            rows: r.grid.rows,
            columns: r.grid.columns,
            gapXMm: r.grid.sourceGapXMm,
            gapYMm: r.grid.sourceGapYMm,
          };
          const inFolder = folder !== null && r.folder === folder;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a grid's place on the page is its identity
            <g key={n} opacity={inFolder ? 1 : 0.45} data-in-folder={inFolder || undefined}>
              <GridOverlay selection={r.selection} grid={spec} viewport={viewport} page={page} color={color} />
              <rect
                data-hit="other-grid"
                data-grid={n}
                x={s.x}
                y={s.y}
                width={s.width}
                height={s.height}
                fill={color}
                fillOpacity={inFolder ? 0.12 : 0.06}
                stroke={color}
                strokeWidth={inFolder ? 2 : 1}
                style={{ cursor: pickable ? (inFolder ? "move" : "pointer") : "inherit" }}
              />
            </g>
          );
        })}
      </g>
      <g pointerEvents="none">
        {group.grids.map((r, n) => {
          if (!r.selection || r.hidden) return null;
          const s = rectToScreen(r.selection, viewport, page);
          if (s.width < MIN_LABEL_WIDTH_PX) return null;
          return (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: a grid's place on the page is its identity
              key={n}
              x={s.x + 2}
              y={s.y - 4}
              fontSize={11}
              fill={r.color ?? "var(--accent)"}
              stroke="var(--bg)"
              strokeWidth={3}
              paintOrder="stroke"
              opacity={n === active ? 1 : 0.8}
            >
              {r.name ?? t("source.grids.item", { n: n + 1 })}
            </text>
          );
        })}
      </g>
    </g>
  );
}
