import { ChevronDown, ChevronRight, MoreVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PanelConfig, PanelOrientation, RegionPosition } from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { PanelPositionItems } from "./PanelPositionMenu";
import { Popover } from "./Popover";

/** How long a panel's body takes to fold away or open. */
export const PANEL_ANIMATION_MS = 160;
/** When each panel was last opened: its body plays the opening animation once (the regions remount on a toggle). */
const openedAt = new Map<string, number>();
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Chrome shared by every panel: title (with the panel's ⓘ, if it has one), the panel's own buttons, move/hide menu
 * and collapse toggle. Collapsing slides the body up before the panel shrinks, and opening slides it down. The
 * test id / data attributes expose where the panel sits and how it is oriented.
 */
export function PanelFrame({
  panel,
  position,
  orientation,
  regionCollapsed,
  info,
  actions,
  children,
}: {
  panel: PanelConfig;
  position: RegionPosition;
  orientation: PanelOrientation;
  /** Every panel of this region is collapsed: the region is a thin strip. */
  regionCollapsed: boolean;
  /** Shown right after the title: the panel's InfoTip. */
  info?: React.ReactNode;
  /** Small buttons before the options menu. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const setCollapsed = usePreferencesStore((s) => s.setPanelCollapsed);
  const { id, collapsed } = panel;
  const [closing, setClosing] = useState(false);
  const open = () => {
    openedAt.set(id, Date.now());
    setCollapsed(id, false);
  };
  const toggle = () => {
    if (collapsed) return open();
    if (reducedMotion()) return setCollapsed(id, true);
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setCollapsed(id, true);
    }, PANEL_ANIMATION_MS);
  };
  const justOpened = Date.now() - (openedAt.get(id) ?? 0) < 400;
  const title = t(`panels.titles.${id}`);
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
          aria-label={t("panels.expand", { title })}
          title={t("panels.expand", { title })}
          onClick={open}
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
          aria-label={collapsed ? t("panels.expand", { title }) : t("panels.collapse", { title })}
          aria-expanded={!collapsed}
          onClick={toggle}
          className="rounded p-0.5 hover:bg-[var(--hover)]"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</span>
        {info}
        <span className="flex-1" />
        {actions}
        <Popover
          label={t("panels.options", { title })}
          triggerClassName="rounded p-0.5 hover:bg-[var(--hover)]"
          trigger={<MoreVertical size={13} />}
        >
          {(close) => <PanelPositionItems id={id} close={close} />}
        </Popover>
      </header>
      {!collapsed && (
        <div
          className={`min-h-0 min-w-0 flex-1 overflow-hidden ${closing ? "panel-body-out" : justOpened ? "panel-body-in" : ""}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
