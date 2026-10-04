import { useEffect } from "react";
import { EditorViewport } from "./components/editor/EditorViewport";
import { EditorToolbar } from "./components/toolbar/EditorToolbar";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { StatusBar } from "./components/toolbar/StatusBar";
import { useDocumentStore } from "./stores/document-store";
import { useEditorStore } from "./stores/editor-store";
import { useLayoutSync } from "./lib/use-layout-sync";
import { zoomActions } from "./lib/zoom-actions";
import { PreferencesDialog } from "./components/preferences/PreferencesDialog";
import { applyTheme } from "./lib/theme";
import { resolveStartMode } from "./lib/preferences";
import { usePreferencesStore } from "./stores/preferences-store";
import { useUiStore } from "./stores/ui-store";
import { useLayoutStore } from "./stores/layout-store";

export default function App() {
  useLayoutSync();

  const theme = usePreferencesStore((s) => s.prefs.appearance.theme);
  useEffect(() => applyTheme(theme), [theme]);

  // Live Preview is only configured in Preferences, so a change applies to the open document too.
  const livePref = usePreferencesStore((s) => s.prefs.preview.livePreview);
  useEffect(() => useLayoutStore.getState().setLive(livePref === "always"), [livePref]);

  // If Preferences hides the workspace currently shown, fall back to a visible one.
  const prefs = usePreferencesStore((s) => s.prefs);
  const viewMode = useEditorStore((s) => s.viewMode);
  useEffect(() => {
    if (!prefs.workspace.visibleModes.includes(viewMode)) useEditorStore.getState().setViewMode(resolveStartMode(prefs));
  }, [prefs, viewMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const doc = useDocumentStore.getState();
      const ed = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        useUiStore.getState().setPrefsOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void doc.openDialog();
        return;
      }
      if (mod || e.altKey || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      switch (e.key) {
        case "v": case "V": ed.setTool("select"); break;
        case "h": case "H": ed.setTool("pan"); break;
        case "+": case "=": zoomActions.zoomIn(); break;
        case "-": zoomActions.zoomOut(); break;
        case "0": zoomActions.fitPage(); break;
        case "PageDown": case "ArrowRight": doc.setCurrentPage(doc.currentPage + 1); break;
        case "PageUp": case "ArrowLeft": doc.setCurrentPage(doc.currentPage - 1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar />
      <div className="min-h-0 flex-1">
        <WorkspaceLayout editor={<EditorViewport />} />
      </div>
      <StatusBar />
      <PreferencesDialog />
    </div>
  );
}
