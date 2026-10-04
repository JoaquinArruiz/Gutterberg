import { useEditorStore } from "../stores/editor-store";
import { useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { sessionDefaults, type WorkspaceMode } from "./preferences";

/** User switched workspace: change the current session and remember it ("last used"). The default preference is untouched. */
export function switchWorkspace(mode: WorkspaceMode) {
  useEditorStore.getState().setViewMode(mode);
  usePreferencesStore.getState().rememberMode(mode);
}

/** A new editor session (document opened): start from the preferences. */
export function startSession() {
  const { viewMode, live } = sessionDefaults(usePreferencesStore.getState().prefs);
  useEditorStore.getState().setViewMode(viewMode);
  useLayoutStore.getState().setLive(live);
}
