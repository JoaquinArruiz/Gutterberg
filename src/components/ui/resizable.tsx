import { Group, Panel, Separator } from "react-resizable-panels";

// Thin shadcn-style wrappers so panels share one look.
export const ResizablePanelGroup = Group;
export const ResizablePanel = Panel;

/** `orientation` is the Group's: a horizontal Group is divided by vertical lines, a vertical Group by horizontal ones. */
export function ResizableHandle({ orientation = "horizontal" }: { orientation?: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={`${orientation === "horizontal" ? "w-px" : "h-px"} bg-[var(--border)] transition-colors data-[separator=hover]:bg-[var(--accent)] data-[separator=active]:bg-[var(--accent)]`}
    />
  );
}
