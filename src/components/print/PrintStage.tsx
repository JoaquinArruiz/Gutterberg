import { useRef } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { HintToast } from "../ui/HintToast";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { CardLibrary } from "./CardLibrary";
import { PrintInspector } from "./PrintInspector";
import { SheetPreview } from "./SheetPreview";

const MIN_SHEET_W = 320;

/**
 * The Print stage: the card library on the left, the sheets in the middle, the inspector on the
 * right. It has its own layout (the widths are remembered separately from the Cards stage's panels).
 */
export function PrintStage() {
  const layout = usePreferencesStore((s) => s.prefs.print.layout);
  const epoch = usePreferencesStore((s) => s.layoutEpoch);
  const save = usePreferencesStore((s) => s.savePrintLayout);
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  // Latest px width of each side panel; written to preferences only after a user drag.
  const widths = useRef<{ libraryWidth?: number; inspectorWidth?: number }>({});

  return (
    <div className="relative h-full w-full">
      <ResizablePanelGroup
        key={epoch}
        orientation="horizontal"
        className="h-full w-full"
        onLayoutChanged={(_l, meta) => {
          if (meta.isUserInteraction) save(widths.current);
        }}
      >
        <ResizablePanel
          id="print-library"
          defaultSize={layout.libraryWidth}
          minSize={200}
          maxSize="45%"
          groupResizeBehavior="preserve-pixel-size"
          onResize={(s) => {
            widths.current.libraryWidth = Math.round(s.inPixels);
          }}
        >
          <CardLibrary />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="print-sheets" minSize={MIN_SHEET_W}>
          <SheetPreview />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="print-inspector"
          defaultSize={layout.inspectorWidth}
          minSize={220}
          maxSize="45%"
          groupResizeBehavior="preserve-pixel-size"
          onResize={(s) => {
            widths.current.inspectorWidth = Math.round(s.inPixels);
          }}
        >
          <div className="h-full border-l border-[var(--border)] bg-[var(--panel)]">
            <PrintInspector />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {hasDocument && (
        <HintToast hint="print-stage-intro" className="absolute bottom-4 left-1/2 z-30 w-[22rem] -translate-x-1/2" />
      )}
    </div>
  );
}
