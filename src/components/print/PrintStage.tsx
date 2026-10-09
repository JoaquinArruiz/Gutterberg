import { useDocumentStore } from "../../stores/document-store";
import { HintToast } from "../ui/HintToast";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout";
import { SheetPreview } from "./SheetPreview";

/**
 * The Print stage: the sheets in the middle, with the piece library and the print settings around them. The
 * panels are the same movable ones as the Source tab's, with a layout of their own (positions, presets and
 * remembered sizes), so moving one here never moves anything there.
 */
export function PrintStage() {
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  return (
    <div className="relative h-full w-full">
      <WorkspaceLayout layoutId="print" editor={<SheetPreview />} />
      {hasDocument && (
        <HintToast hint="print-stage-intro" className="absolute bottom-4 left-1/2 z-30 w-[22rem] -translate-x-1/2" />
      )}
    </div>
  );
}
