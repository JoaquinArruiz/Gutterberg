import { useEffect } from "react";
import { EditorViewport } from "./components/editor/EditorViewport";
import { PagesSidebar } from "./components/sidebar/PagesSidebar";
import { PropertiesSidebar } from "./components/sidebar/PropertiesSidebar";
import { EditorToolbar } from "./components/toolbar/EditorToolbar";
import { StatusBar } from "./components/toolbar/StatusBar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { useDocumentStore } from "./stores/document-store";

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useDocumentStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void s.openDialog();
      } else if (e.key === "PageDown" || e.key === "ArrowRight") s.setCurrentPage(s.currentPage + 1);
      else if (e.key === "PageUp" || e.key === "ArrowLeft") s.setCurrentPage(s.currentPage - 1);
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
    </div>
  );
}
