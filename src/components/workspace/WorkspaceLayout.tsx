import { type ReactNode, useMemo, useRef } from "react";
import { useWindowSize } from "../../lib/use-window-size";
import {
  constrainLayout,
  HEADER_PX,
  isRegionCollapsed,
  MIN_EDITOR_H,
  MIN_EDITOR_W,
  type PanelConfig,
  type PanelId,
  panelOrientation,
  type RegionPosition,
  regionMinSize,
  regionSize,
  regionsOf,
  STRIP_PX,
} from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { PagesPanel } from "../sidebar/PagesPanel";
import { PropertiesSidebar } from "../sidebar/PropertiesSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { PanelFrame } from "./PanelFrame";

/** What each panel id renders. A new panel = one entry here + one in PANEL_DEFS. */
const PANEL_BODY: Record<PanelId, (p: { orientation: "vertical" | "horizontal" }) => ReactNode> = {
  pages: ({ orientation }) => <PagesPanel orientation={orientation} />,
  properties: () => <PropertiesSidebar />,
};

function Region({ position, panels }: { position: RegionPosition; panels: PanelConfig[] }) {
  const orientation = panelOrientation(position);
  const regionCollapsed = isRegionCollapsed(panels);
  const saveStack = usePreferencesStore((s) => s.saveStackSize);

  const frame = (p: PanelConfig) => (
    <PanelFrame panel={p} position={position} orientation={orientation} regionCollapsed={regionCollapsed}>
      {PANEL_BODY[p.id]({ orientation })}
    </PanelFrame>
  );

  let body: ReactNode;
  if (panels.length === 1) {
    body = frame(panels[0]);
  } else {
    // Same-side panels stack, separated by a resizable divider.
    const shares = panels.map((p) => p.stackSize?.[position]);
    const useShares = !panels.some((p) => p.collapsed) && shares.every((v) => v !== undefined);
    body = (
      <ResizablePanelGroup
        orientation="vertical"
        className="h-full w-full"
        onLayoutChanged={(l, meta) => {
          if (meta.isUserInteraction)
            for (const p of panels) if (l[p.id] !== undefined) saveStack(p.id, position, l[p.id]);
        }}
      >
        {panels.flatMap((p, i) => [
          i > 0 ? <ResizableHandle key={`h-${p.id}`} orientation="vertical" /> : null,
          <ResizablePanel
            key={p.id}
            id={p.id}
            {...(p.collapsed
              ? { defaultSize: HEADER_PX, minSize: HEADER_PX, maxSize: HEADER_PX }
              : { minSize: 80, ...(useShares ? { defaultSize: `${shares[i]}%` } : {}) })}
          >
            {frame(p)}
          </ResizablePanel>,
        ])}
      </ResizablePanelGroup>
    );
  }
  return (
    <div data-testid={`workspace-region-${position}`} className="h-full w-full min-h-0 min-w-0">
      {body}
    </div>
  );
}

/**
 * The editor plus the regions (left/right/top/bottom) that hold the panels.
 * Panel positions are never hard-coded here: regions are derived from the
 * layout config, so every placement rule lives in lib/workspace-layout.
 */
export function WorkspaceLayout({ editor }: { editor: ReactNode }) {
  const preferred = usePreferencesStore((s) => s.prefs.workspace.layout);
  const epoch = usePreferencesStore((s) => s.layoutEpoch);
  const saveRegionSize = usePreferencesStore((s) => s.saveRegionSize);
  const win = useWindowSize();
  // Too small a window collapses panels for now; the stored preference is untouched.
  const layout = useMemo(() => constrainLayout(preferred, win), [preferred, win]);
  const regions = regionsOf(layout.panels);

  // Latest px size of each region; written to preferences only after a user drag
  // (never for window resizes) and never for collapsed regions.
  const sizes = useRef<Partial<Record<RegionPosition, number>>>({});
  const onRegionResize = (pos: RegionPosition, px: number) => {
    sizes.current[pos] = px;
  };
  const commitSizes = (positions: RegionPosition[], user: boolean) => {
    if (!user) return;
    for (const pos of positions) {
      const px = sizes.current[pos];
      if (px !== undefined) saveRegionSize(pos, px);
    }
  };

  const region = (pos: RegionPosition) => {
    const panels = regions[pos];
    if (panels.length === 0) return null;
    const collapsed = isRegionCollapsed(panels);
    const size = collapsed ? STRIP_PX : regionSize(layout, pos, panels);
    const min = collapsed ? STRIP_PX : regionMinSize(pos, panels);
    return (
      <ResizablePanel
        id={`region-${pos}`}
        defaultSize={size}
        minSize={min}
        maxSize={collapsed ? STRIP_PX : "60%"}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(s) => !collapsed && onRegionResize(pos, s.inPixels)}
      >
        <Region position={pos} panels={panels} />
      </ResizablePanel>
    );
  };

  const left = region("left");
  const right = region("right");
  const top = region("top");
  const bottom = region("bottom");

  // Structural signature: remount the groups only when panels move/collapse or sizes are reset,
  // not on every drag (so remembered sizes apply as defaults, and dragging stays smooth).
  const sig =
    (["left", "right", "top", "bottom"] as RegionPosition[])
      .map((pos) => `${pos}:${regions[pos].map((p) => p.id + (p.collapsed ? "c" : "")).join(",")}`)
      .join("|") + `#${epoch}`;

  const middle =
    left || right ? (
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full w-full"
        onLayoutChanged={(_l, m) => commitSizes(["left", "right"], m.isUserInteraction)}
      >
        {left}
        {left && <ResizableHandle />}
        <ResizablePanel id="editor" minSize={MIN_EDITOR_W}>
          {editor}
        </ResizablePanel>
        {right && <ResizableHandle />}
        {right}
      </ResizablePanelGroup>
    ) : (
      <div className="h-full w-full min-h-0 min-w-0">{editor}</div>
    );

  return top || bottom ? (
    <ResizablePanelGroup
      key={sig}
      orientation="vertical"
      className="h-full w-full"
      onLayoutChanged={(_l, m) => commitSizes(["top", "bottom"], m.isUserInteraction)}
    >
      {top}
      {top && <ResizableHandle orientation="vertical" />}
      <ResizablePanel id="middle" minSize={MIN_EDITOR_H}>
        {middle}
      </ResizablePanel>
      {bottom && <ResizableHandle orientation="vertical" />}
      {bottom}
    </ResizablePanelGroup>
  ) : (
    <div key={sig} className="h-full w-full min-h-0 min-w-0">
      {middle}
    </div>
  );
}
