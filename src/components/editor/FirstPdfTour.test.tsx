// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Step, TooltipRenderProps } from "react-joyride";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitHintEvent } from "../../lib/hint-events";
import type { HintTargetId } from "../../lib/hints";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { FirstPdfTour } from "./FirstPdfTour";

// Joyride measures and positions with real layout, which jsdom does not have: this stand-in renders
// the app's own tooltip and exposes the step it was given. The tour logic around it is what is tested.
const joyrideSteps: Step[][] = [];
vi.mock("react-joyride", () => ({
  Joyride: ({ steps, tooltipComponent: Tooltip }: { steps: Step[]; tooltipComponent: React.ElementType }) => {
    joyrideSteps.push(steps);
    return (
      <div data-testid="joyride" data-placement={steps[0].placement}>
        <Tooltip {...({} as TooltipRenderProps)} />
      </div>
    );
  },
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const region = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const tour = () => screen.queryByTestId("hint-first-pdf-tour");
const dismissed = () => usePreferencesStore.getState().prefs.help.dismissedHints;
const stepLabel = (n: number) => screen.getByText(`${n} / 4`);

/** A target element as the real UI marks it. `visible: false` mimics a hidden panel (no layout box). */
function addTarget(id: HintTargetId, visible = true) {
  const el = document.createElement("div");
  el.dataset.hintTarget = id;
  (el as HTMLElement).getClientRects = () =>
    visible ? ([{}] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
  document.body.append(el);
  return el;
}
const targetsOf = (...ids: HintTargetId[]) => ids.map((id) => addTarget(id));

beforeEach(() => {
  joyrideSteps.length = 0;
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.setState({ stage: "cards" });
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(2);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("first PDF tour", () => {
  it("does not start without a document", () => {
    useDocumentStore.getState().clear();
    render(<FirstPdfTour />);
    expect(tour()).toBeNull();
  });

  it("does not start when the PDF already has a region", () => {
    useLayoutStore.getState().setSelection(0, region);
    render(<FirstPdfTour />);
    expect(tour()).toBeNull();
  });

  it("starts when a PDF is open and no region is drawn", () => {
    render(<FirstPdfTour />);
    expect(tour()).toBeTruthy();
    expect(stepLabel(1)).toBeTruthy();
  });

  it("points at the page, then the grid fields, then the stage tabs, advancing on the app events", () => {
    const [canvas, tip, grid, tabs] = targetsOf("page-canvas", "page-canvas-tip", "grid-fields", "stage-tabs");
    render(<FirstPdfTour />);
    expect(screen.getByTestId("joyride")).toBeTruthy();
    // The whole canvas is lit, but the tip sits at a small marker inside it so it stays in the window.
    expect(joyrideSteps.at(-1)?.[0].spotlightTarget).toBe(canvas);
    expect(joyrideSteps.at(-1)?.[0].target).toBe(tip);

    act(() => useLayoutStore.getState().setSelection(0, region)); // drawing the region
    expect(stepLabel(2)).toBeTruthy();
    expect(joyrideSteps.at(-1)?.[0].target).toBe(grid);
    expect(joyrideSteps.at(-1)?.[0].spotlightTarget).toBe(grid);

    act(() => useLayoutStore.getState().setGrid(0, { columns: 4 })); // typing a value
    expect(stepLabel(3)).toBeTruthy();
    expect(joyrideSteps.at(-1)?.[0].spotlightTarget).toBe(canvas);
    expect(joyrideSteps.at(-1)?.[0].target).toBe(tip);

    fireEvent.click(screen.getByRole("button", { name: "Next tip" })); // no event: Next moves on
    expect(stepLabel(4)).toBeTruthy();
    expect(joyrideSteps.at(-1)?.[0].target).toBe(tabs);

    act(() => useUiStore.getState().setStage("print")); // the keyboard or the mouse: same event
    expect(dismissed()).toEqual({ "first-pdf-tour": 1 });
    expect(tour()).toBeNull();
  });

  it("ignores events that belong to other steps", () => {
    render(<FirstPdfTour />);
    act(() => emitHintEvent("grid-changed"));
    act(() => emitHintEvent("stage-changed:print"));
    expect(stepLabel(1)).toBeTruthy();
  });

  it("lets Back return to an earlier step", () => {
    render(<FirstPdfTour />);
    act(() => emitHintEvent("selection-created"));
    fireEvent.click(screen.getByRole("button", { name: "Previous tip" }));
    expect(stepLabel(1)).toBeTruthy();
  });

  it("can be skipped on any step, and stays away", () => {
    const { unmount } = render(<FirstPdfTour />);
    act(() => emitHintEvent("selection-created"));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(dismissed()).toEqual({ "first-pdf-tour": 1 });
    expect(tour()).toBeNull();
    unmount();
    render(<FirstPdfTour />);
    expect(tour()).toBeNull();
  });

  it("can be closed with the X, and with Escape while pointing at a target", () => {
    render(<FirstPdfTour />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(tour()).toBeNull();

    usePreferencesStore.getState().resetHints();
    targetsOf("page-canvas", "page-canvas-tip");
    cleanup();
    render(<FirstPdfTour />);
    expect(screen.getByTestId("joyride")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tour()).toBeNull();
  });

  it("shows a plain toast when the target is not in the page or is hidden", () => {
    addTarget("page-canvas", false);
    render(<FirstPdfTour />);
    expect(tour()).toBeTruthy();
    expect(screen.queryByTestId("joyride")).toBeNull();
    act(() => emitHintEvent("selection-created")); // grid fields do not exist at all
    expect(screen.queryByTestId("joyride")).toBeNull();
    expect(stepLabel(2)).toBeTruthy();
  });

  it("moves next to the target once it appears", async () => {
    render(<FirstPdfTour />);
    expect(screen.queryByTestId("joyride")).toBeNull();
    await act(async () => {
      targetsOf("page-canvas", "page-canvas-tip");
    });
    expect(screen.getByTestId("joyride")).toBeTruthy();
    expect(screen.getByTestId("joyride").dataset.placement).toBe("top");
  });

  it("is hidden outside the Cards stage", () => {
    render(<FirstPdfTour />);
    act(() => useUiStore.setState({ stage: "print" }));
    expect(tour()).toBeNull();
  });
});
