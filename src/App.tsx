import { useEffect } from "react";
import { AiConfirmDialog } from "./components/ai/AiConfirmDialog";
import { EditorViewport } from "./components/editor/EditorViewport";
import { FirstPdfTour } from "./components/editor/FirstPdfTour";
import { ImageSizeDialog } from "./components/images/ImageSizeDialog";
import { PreferencesDialog } from "./components/preferences/PreferencesDialog";
import { PrintStage } from "./components/print/PrintStage";
import { StartScreen } from "./components/start/StartScreen";
import { EditorToolbar } from "./components/toolbar/EditorToolbar";
import { ProjectNotices } from "./components/toolbar/ProjectNotices";
import { StatusBar } from "./components/toolbar/StatusBar";
import { ShortcutsDialog } from "./components/ui/ShortcutsDialog";
import { Toast } from "./components/ui/Toast";
import { useWelcomeAutoOpen, WelcomeDialog } from "./components/welcome/WelcomeDialog";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";
import { resolveStartMode } from "./lib/preferences";
import { newProject, openPdfDialog, openProjectDialog, saveProject, saveProjectAs } from "./lib/project-actions";
import { useProjectTracking } from "./lib/project-state";
import { isShortcutsKey } from "./lib/shortcuts";
import { applyTheme } from "./lib/theme";
import { startUpdateChecks } from "./lib/update-actions";
import { useImageDrop } from "./lib/use-image-drop";
import { useLayoutSync } from "./lib/use-layout-sync";
import { useOpenedFiles } from "./lib/use-opened-files";
import { usePrintSync } from "./lib/use-print-sync";
import { zoomActions } from "./lib/zoom-actions";
import { useDocumentStore } from "./stores/document-store";
import { useEditorStore } from "./stores/editor-store";
import { redo, undo } from "./stores/history";
import { useLayoutStore } from "./stores/layout-store";
import { usePreferencesStore } from "./stores/preferences-store";
import { useUiStore } from "./stores/ui-store";

export default function App() {
  useLayoutSync();
  usePrintSync();
  useProjectTracking();
  useImageDrop();
  // Before the welcome tour: a project the app was started with is opened first, and the tour waits for it.
  useOpenedFiles();
  useWelcomeAutoOpen();
  useEffect(startUpdateChecks, []);
  const stage = useUiStore((s) => s.stage);
  // With nothing open there is nothing to edit: the start screen takes the place of the editor and its panels.
  const hasDocuments = useDocumentStore((s) => s.documents.length > 0);

  const theme = usePreferencesStore((s) => s.prefs.appearance.theme);
  useEffect(() => applyTheme(theme), [theme]);

  // Live Preview is only configured in Preferences, so a change applies to the open document too.
  const livePref = usePreferencesStore((s) => s.prefs.preview.livePreview);
  useEffect(() => useLayoutStore.getState().setLive(livePref === "always"), [livePref]);

  // If Preferences hides the workspace currently shown, fall back to a visible one.
  const prefs = usePreferencesStore((s) => s.prefs);
  const viewMode = useEditorStore((s) => s.viewMode);
  useEffect(() => {
    if (!prefs.workspace.visibleModes.includes(viewMode))
      useEditorStore.getState().setViewMode(resolveStartMode(prefs));
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
      // `?` opens the list of shortcuts (it never types into a field), and again closes it.
      if (isShortcutsKey(e)) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName);
      const key = e.key.toLowerCase();
      // Inside a text field Ctrl+Z stays the field's own undo.
      if (mod && !typing && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      // File menu shortcuts. They work inside text fields too, as in any editor.
      if (mod && key === "o") {
        e.preventDefault();
        void (e.shiftKey ? openProjectDialog() : openPdfDialog());
        return;
      }
      if (mod && key === "n") {
        e.preventDefault();
        void newProject();
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        void (e.shiftKey ? saveProjectAs() : saveProject());
        return;
      }
      // The single-key shortcuts drive the page editor (tools, zoom, paging): the Print stage has none.
      if (useUiStore.getState().stage !== "cards") return;
      if (mod || e.altKey || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      switch (e.key) {
        case "v":
        case "V":
          ed.setTool("select");
          break;
        case "c":
        case "C":
          ed.setTool("card");
          break;
        case "h":
        case "H":
          ed.setTool("pan");
          break;
        case "Delete":
        case "Backspace": {
          // Deletes the freeform card being edited.
          const picked = ed.selectedCard;
          if (ed.tool === "card" && picked?.page === doc.currentPage) {
            e.preventDefault();
            useLayoutStore.getState().deleteFreeformCard(picked.page, picked.index);
            ed.setSelectedCard(null);
          }
          break;
        }
        case "Escape":
          ed.setSelectedCard(null);
          break;
        case "+":
        case "=":
          zoomActions.zoomIn();
          break;
        case "-":
          zoomActions.zoomOut();
          break;
        case "0":
          zoomActions.fitPage();
          break;
        case "PageDown":
        case "ArrowRight":
          doc.setCurrentPage(doc.currentPage + 1);
          break;
        case "PageUp":
        case "ArrowLeft":
          doc.setCurrentPage(doc.currentPage - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar />
      <ProjectNotices />
      <div className="min-h-0 flex-1">
        {!hasDocuments ? (
          <StartScreen />
        ) : stage === "print" ? (
          <PrintStage />
        ) : (
          <WorkspaceLayout layoutId="cards" editor={<EditorViewport />} />
        )}
      </div>
      <StatusBar />
      <FirstPdfTour />
      <PreferencesDialog />
      <ShortcutsDialog />
      <AiConfirmDialog />
      <ImageSizeDialog />
      <WelcomeDialog />
      <Toast />
    </div>
  );
}
