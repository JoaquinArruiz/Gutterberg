import { useUiStore } from "../stores/ui-store";
import type { HintActionId } from "./hints";

/** What each named hint button does. The catalog only holds the names. */
const ACTIONS: Record<HintActionId, () => void> = {
  "open-preferences:preview": () => useUiStore.getState().setPrefsOpen(true, "Preview"),
};

export const runHintAction = (id: HintActionId) => ACTIONS[id]();
