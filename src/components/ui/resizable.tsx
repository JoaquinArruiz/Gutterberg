import { Group, Panel, Separator } from "react-resizable-panels";

// Thin shadcn-style wrappers so panels share one look.
export const ResizablePanelGroup = Group;
export const ResizablePanel = Panel;

export function ResizableHandle() {
  return (
    <Separator className="w-px bg-[var(--border)] transition-colors data-[separator=hover]:bg-[var(--accent)] data-[separator=active]:bg-[var(--accent)]" />
  );
}
