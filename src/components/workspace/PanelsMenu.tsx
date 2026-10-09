import { LayoutPanelLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LAYOUT_PANELS } from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { PanelPositionItems } from "./PanelPositionMenu";
import { Popover } from "./Popover";

/**
 * Toolbar "Panels" menu: the always-available way to move or bring back any
 * panel of the tab being shown, including ones that are currently hidden.
 */
export function PanelsMenu() {
  const { t } = useTranslation();
  const stage = useUiStore((s) => s.stage);
  const panels = usePreferencesStore(
    (s) => (stage === "cards" ? s.prefs.workspace.layout : s.prefs.print.layout).panels,
  );
  return (
    <Popover
      label={t("panels.menu")}
      testId="panels-menu"
      triggerClassName="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--hover)]"
      trigger={<LayoutPanelLeft size={14} />}
    >
      {(close) =>
        LAYOUT_PANELS[stage].map((id) => (
          <div key={id} className="mb-1 border-b border-[var(--border)] pb-1 last:mb-0 last:border-0 last:pb-0">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {panels.find((p) => p.id === id)?.position === "hidden"
                ? t("panels.titleHidden", { title: t(`panels.titles.${id}`) })
                : t(`panels.titles.${id}`)}
            </div>
            <PanelPositionItems id={id} close={close} />
          </div>
        ))
      }
    </Popover>
  );
}
