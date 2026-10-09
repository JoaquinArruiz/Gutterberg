import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PANEL_DEFS, type PanelId, type PanelPosition } from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { menuItem } from "./Popover";

/** Position choices for one panel; only positions that panel supports are listed. */
export function PanelPositionItems({ id, close }: { id: PanelId; close: () => void }) {
  const { t } = useTranslation();
  const current = usePreferencesStore((s) =>
    [...s.prefs.workspace.layout.panels, ...s.prefs.print.layout.panels].find((p) => p.id === id),
  )?.position;
  const setPosition = usePreferencesStore((s) => s.setPanelPosition);
  return (
    <>
      {PANEL_DEFS[id].positions.map((pos: PanelPosition) => (
        <button
          type="button"
          key={pos}
          role="menuitemradio"
          aria-checked={current === pos}
          onClick={() => {
            setPosition(id, pos);
            close();
          }}
          className={menuItem}
        >
          <span className="w-3">{current === pos && <Check size={12} />}</span>
          {pos === "hidden" ? t("panels.hide") : t(`panels.move.${pos}`)}
        </button>
      ))}
    </>
  );
}
