import { usePreferencesStore } from "../stores/preferences-store";
import { useUiStore } from "../stores/ui-store";
import type { HintActionId } from "./hints";
import { openPdfDialog } from "./project-actions";

const openSection = (id: string) => usePreferencesStore.getState().setSectionOpen(id, true);

/** What each named hint button does. The catalog only holds the names. */
const ACTIONS: Record<HintActionId, () => void> = {
  "open-preferences:preview": () => useUiStore.getState().setPrefsOpen(true, "Display", "livePreview"),
  "open-preferences:updates": () => useUiStore.getState().setPrefsOpen(true, "Updates"),
  "open-bug-report": () => useUiStore.getState().setPrefsOpen(true, "About", "bugReport"),
  "open-pdf": () => void openPdfDialog(),
  "go-stage:cards": () => useUiStore.getState().setStage("cards"),
  "go-stage:print": () => useUiStore.getState().setStage("print"),
  // The Print tab's sections fold, and which are open is the user's view of the panel, not part of the project.
  "open-section:print.sheet": () => openSection("print.sheet"),
  "open-section:print.page": () => openSection("print.page"),
  "open-section:print.duplex": () => openSection("print.duplex"),
  "start-tutorial:mark-and-export": () => useUiStore.getState().startTutorial("mark-and-export"),
};

export const runHintAction = (id: HintActionId) => ACTIONS[id]();
