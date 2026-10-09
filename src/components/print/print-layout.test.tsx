// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridCardId } from "../../lib/card";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore } from "../../stores/ui-store";
import { PanelsMenu } from "../workspace/PanelsMenu";
import { PrintStage } from "./PrintStage";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderRegion: vi.fn(async () => "blob:card"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const prefs = () => usePreferencesStore.getState();
const panel = (id: string) => screen.queryByTestId(`${id}-panel`);

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: unknown[]) => void) {}
      // The panel groups read the border box, the library its content rect.
      observe(target: Element) {
        this.cb([
          {
            target,
            contentRect: { width: 400, height: 500 },
            borderBoxSize: [{ inlineSize: 400, blockSize: 500 }],
          },
        ]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  prefs().resetToDefaults();
  usePrintStore.getState().reset();
  useUiStore.setState({ stage: "print" });
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(1);
  usePrintStore.setState({
    cards: [
      {
        id: gridCardId(0, 0, 0, 0),
        source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
        scale: 1,
        turn: 0,
      },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Print tab's panels", () => {
  it("shows the piece library on the left and the print settings on the right, around the sheets", () => {
    render(<PrintStage />);
    expect(panel("library")?.getAttribute("data-position")).toBe("left");
    expect(panel("inspector")?.getAttribute("data-position")).toBe("right");
    expect(panel("library")?.querySelector("[data-testid=card-library]")).toBeTruthy();
    expect(panel("inspector")?.querySelector("[data-testid=print-inspector]")).toBeTruthy();
    // Neither of the Source tab's panels is here.
    expect(panel("pages")).toBeNull();
    expect(panel("properties")).toBeNull();
  });

  it("puts the library in a strip, laid out horizontally, when it is moved to the top", () => {
    render(<PrintStage />);
    act(() => prefs().setPanelPosition("library", "top"));
    expect(panel("library")?.getAttribute("data-position")).toBe("top");
    expect(panel("library")?.getAttribute("data-orientation")).toBe("horizontal");
    expect(screen.getByTestId("card-library").getAttribute("data-orientation")).toBe("horizontal");
    expect(panel("inspector")?.getAttribute("data-position")).toBe("right");
  });

  it("stacks both panels on the same side when asked for a right sidebar", () => {
    render(<PrintStage />);
    act(() => prefs().applyLayoutPreset("print", "right-sidebar"));
    expect(panel("library")?.getAttribute("data-position")).toBe("right");
    expect(panel("inspector")?.getAttribute("data-position")).toBe("right");
  });

  it("leaves only the sheets when both are hidden, and shows them again from the Panels menu", () => {
    const { rerender } = render(
      <>
        <PanelsMenu />
        <PrintStage />
      </>,
    );
    act(() => {
      prefs().setPanelPosition("library", "hidden");
      prefs().setPanelPosition("inspector", "hidden");
    });
    expect(panel("library")).toBeNull();
    expect(panel("inspector")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Panels" }));
    // The menu lists this tab's panels, not the Source tab's.
    expect(screen.getByText("Piece library (hidden)")).toBeTruthy();
    expect(screen.getByText("Print settings (hidden)")).toBeTruthy();
    expect(screen.queryByText(/^Pages/)).toBeNull();
    fireEvent.click(screen.getAllByRole("menuitemradio", { name: "Move left" })[0]);
    expect(prefs().prefs.print.layout.panels.find((p) => p.id === "library")?.position).toBe("left");
    rerender(<PrintStage />);
    expect(panel("library")).toBeTruthy();
  });

  it("never touches the Source tab's layout, and the Source tab's moves never touch it", () => {
    render(<PrintStage />);
    const source = () => prefs().prefs.workspace.layout.panels.map((p) => `${p.id}:${p.position}`);
    act(() => prefs().setPanelPosition("library", "bottom"));
    expect(source()).toEqual(["pages:left", "properties:right"]);
    act(() => prefs().setPanelPosition("pages", "top"));
    expect(panel("library")?.getAttribute("data-position")).toBe("bottom");
  });

  it("remembers where the panels are across a restart of the view", () => {
    const first = render(<PrintStage />);
    act(() => prefs().setPanelPosition("inspector", "left"));
    first.unmount();
    render(<PrintStage />);
    expect(panel("inspector")?.getAttribute("data-position")).toBe("left");
  });
});
