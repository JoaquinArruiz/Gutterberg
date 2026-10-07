import { ChevronDown, ChevronRight, MoreVertical } from "lucide-react";
import { PANEL_DEFS, type PanelConfig, type PanelOrientation, type RegionPosition } from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { PanelPositionItems } from "./PanelPositionMenu";
import { Popover } from "./Popover";

/**
 * Chrome shared by every panel: title, move/hide menu and collapse toggle. The
 * test id / data attributes expose where the panel sits and how it is oriented.
 */
export function PanelFrame({
  panel,
  position,
  orientation,
  regionCollapsed,
  children,
}: {
  panel: PanelConfig;
  position: RegionPosition;
  orientation: PanelOrientation;
  /** Every panel of this region is collapsed: the region is a thin strip. */
  regionCollapsed: boolean;
  children: React.ReactNode;
}) {
  const setCollapsed = usePreferencesStore((s) => s.setPanelCollapsed);
  const { id, collapsed } = panel;
  const title = PANEL_DEFS[id].title;
  const attrs = {
    "data-testid": `${id}-panel`,
    "data-position": position,
    "data-orientation": orientation,
    "data-collapsed": collapsed ? "true" : "false",
  };

  // Collapsed region on a side: a slim strip with the title running vertically.
  if (regionCollapsed && orientation === "vertical") {
    return (
      <section {...attrs} className="flex h-full w-full flex-col items-center bg-[var(--panel)] py-1">
        <button
          type="button"
          aria-label={`Expand ${title}`}
          title={`Expand ${title}`}
          onClick={() => setCollapsed(id, false)}
          className="flex flex-col items-center gap-2 rounded px-1 py-1 hover:bg-[var(--hover)]"
        >
          <ChevronRight size={14} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] [writing-mode:vertical-rl]">
            {title}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section {...attrs} className="flex h-full w-full min-h-0 min-w-0 flex-col bg-[var(--panel)]">
      <header className="flex h-7 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(id, !collapsed)}
          className="rounded p-0.5 hover:bg-[var(--hover)]"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {title}
        </span>
        <Popover
          label={`${title} panel options`}
          triggerClassName="rounded p-0.5 hover:bg-[var(--hover)]"
          trigger={<MoreVertical size={13} />}
        >
          {(close) => <PanelPositionItems id={id} close={close} />}
        </Popover>
      </header>
      {!collapsed && <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>}
    </section>
  );
}
