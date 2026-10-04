import { Check } from "lucide-react";
import {
  PANEL_DEFS, POSITION_LABEL, type PanelId, type PanelPosition,
} from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { menuItem } from "./Popover";

/** Position choices for one panel; only positions that panel supports are listed. */
export function PanelPositionItems({ id, close }: { id: PanelId; close: () => void }) {
  const current = usePreferencesStore((s) => s.prefs.workspace.layout.panels.find((p) => p.id === id)?.position);
  const setPosition = usePreferencesStore((s) => s.setPanelPosition);
  return (
    <>
      {PANEL_DEFS[id].positions.map((pos: PanelPosition) => (
        <button
          key={pos}
          role="menuitemradio"
          aria-checked={current === pos}
          onClick={() => { setPosition(id, pos); close(); }}
          className={menuItem}
        >
          <span className="w-3">{current === pos && <Check size={12} />}</span>
          {pos === "hidden" ? "Hide" : `Move ${POSITION_LABEL[pos]}`}
        </button>
      ))}
    </>
  );
}
