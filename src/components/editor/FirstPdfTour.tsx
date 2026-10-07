import { useEffect, useState } from "react";
import { useDocumentStore } from "../../stores/document-store";
import { useCurrentGridGroup } from "../../stores/layout-store";
import { useUiStore } from "../../stores/ui-store";
import { HintToast } from "../ui/HintToast";

/**
 * The first-PDF walkthrough: starts when a PDF is open and no card region has been drawn yet, and keeps
 * going after the region is drawn (it is a tour, not a notice about the missing region). A project that
 * already has a region never starts it.
 */
export function FirstPdfTour() {
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  const stage = useUiStore((s) => s.stage);
  const noRegion = !useCurrentGridGroup()?.selection;
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!hasDocument) setStarted(false);
    else if (noRegion) setStarted(true);
  }, [hasDocument, noRegion]);

  if (!started || stage !== "cards") return null;
  return <HintToast hint="first-pdf-tour" className="fixed bottom-10 left-1/2 z-50 w-[22rem] -translate-x-1/2" />;
}
