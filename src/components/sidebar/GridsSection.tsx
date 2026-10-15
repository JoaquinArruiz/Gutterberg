import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type GridGroup, MAX_GRIDS } from "../../lib/document-layout";
import { useEditorStore } from "../../stores/editor-store";
import { useActiveGrid, useLayoutStore } from "../../stores/layout-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";

/**
 * The grids of the viewed page's group: one row per grid ("Grid 2 · 3×3"), the picked one pressed. Picking a grid
 * makes it the one the page and the sections below edit; "Add grid" adds one with no region, picked, so the next drag
 * on the page draws it.
 */
export function GridsSection({ group, page }: { group: GridGroup; page: number }) {
  const { t } = useTranslation();
  const active = useActiveGrid();
  const setActive = useLayoutStore((s) => s.setActiveGrid);
  const add = useLayoutStore((s) => s.addGrid);
  const remove = useLayoutStore((s) => s.deleteGrid);
  const several = group.grids.length > 1;
  const full = group.grids.length >= MAX_GRIDS;
  const pick = (n: number) => {
    setActive(n);
    useEditorStore.getState().setTool("select");
    // The arrow keys then move the grid that was picked.
    useEditorStore.getState().setPickedRegion(page);
  };
  return (
    <CollapsibleSection id="cards.grids" title={t("source.sections.grids")} info={t("source.grids.note")}>
      <ul className="flex flex-col gap-1" data-hint-target="grid-list">
        {group.grids.map((r, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a grid's place in the list is its identity
          <li key={n} className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={n === active}
              title={t("source.grids.pick", { n: n + 1 })}
              onClick={() => pick(n)}
              className={`flex min-w-0 flex-1 justify-between gap-2 rounded px-2 py-0.5 text-left ${
                n === active ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "hover:bg-[var(--hover)]"
              }`}
            >
              <span className="truncate">{t("source.grids.item", { n: n + 1 })}</span>
              <span className={`tabular-nums ${n === active ? "" : "text-[var(--muted)]"}`}>
                {r.selection ? `${r.grid.rows}×${r.grid.columns}` : t("source.grids.noRegion")}
              </span>
            </button>
            {several && (
              <Button
                variant="ghost"
                aria-label={t("source.grids.delete", { n: n + 1 })}
                title={t("source.grids.delete", { n: n + 1 })}
                onClick={() => remove(page, n)}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button
          className="inline-flex items-center gap-1"
          disabled={full}
          title={full ? t("source.grids.full", { count: MAX_GRIDS }) : t("source.grids.addTitle")}
          onClick={() => {
            add(page);
            // The new grid is drawn with the Grid region tool.
            useEditorStore.getState().setTool("select");
            useEditorStore.getState().setPickedRegion(page);
          }}
        >
          <Plus size={12} />
          {t("source.grids.add")}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
