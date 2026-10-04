import { useEffect } from "react";
import { EditorViewport } from "./components/editor/EditorViewport";
import { PagesSidebar } from "./components/sidebar/PagesSidebar";
import { PropertiesSidebar } from "./components/sidebar/PropertiesSidebar";
import { EditorToolbar } from "./components/toolbar/EditorToolbar";
import { StatusBar } from "./components/toolbar/StatusBar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { useDocumentStore } from "./stores/document-store";
import { useEditorStore } from "./stores/editor-store";
import { useLayoutSync } from "./lib/use-layout-sync";
import { zoomActions } from "./lib/zoom-actions";
import { PreferencesDialog } from "./components/preferences/PreferencesDialog";
import { applyTheme } from "./lib/theme";
import { resolveStartMode } from "./lib/preferences";
import { usePreferencesStore } from "./stores/preferences-store";
import { useUiStore } from "./stores/ui-store";

export default function App() {
  useLayoutSync();

  const theme = usePreferencesStore((s) => s.prefs.appearance.theme);
  useEffect(() => applyTheme(theme), [theme]);

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
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="16%" minSize="10%" maxSize="30%">
          <PagesSidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize="30%">
          <EditorViewport />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="20%" minSize="14%" maxSize="35%">
          <PropertiesSidebar />
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
      <PreferencesDialog />
    </div>
  );
}
