import { LayoutPanelLeft } from "lucide-react";
import { PANEL_DEFS, PANEL_IDS } from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { PanelPositionItems } from "./PanelPositionMenu";
import { Popover } from "./Popover";

/**
 * Toolbar "Panels" menu: the always-available way to move or bring back any
 * panel, including ones that are currently hidden.
 */
export function PanelsMenu() {
  const panels = usePreferencesStore((s) => s.prefs.workspace.layout.panels);
  return (
    <Popover
      label="Panels"
      testId="panels-menu"
      triggerClassName="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-[var(--hover)]"
      trigger={<LayoutPanelLeft size={14} />}
    >
      {(close) =>
        PANEL_IDS.map((id) => (
          <div key={id} className="mb-1 border-b border-[var(--border)] pb-1 last:mb-0 last:border-0 last:pb-0">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {PANEL_DEFS[id].title}
              {panels.find((p) => p.id === id)?.position === "hidden" ? " (hidden)" : ""}
            </div>
            <PanelPositionItems id={id} close={close} />
          </div>
        ))
      }
    </Popover>
  );
}
