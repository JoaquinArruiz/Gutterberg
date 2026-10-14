// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { EditorViewport } from "./EditorViewport";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
  renderRegion: vi.fn(async () => "blob:crop"),
}));
vi.mock("../../lib/edges-api", () => ({ pageEdges: async () => ({ vertical: [], horizontal: [] }) }));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const svg = () => screen.getByRole("img", { name: "Page canvas" });

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: 800, height: 1000 } }]);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  if (!("PointerEvent" in window)) vi.stubGlobal("PointerEvent", MouseEvent);
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(1);
  useEditorStore.setState({ tool: "select", viewMode: "source", fitMode: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("rulers", () => {
  it("are off by default and take no room", () => {
    render(<EditorViewport />);
    expect(screen.queryByTestId("ruler-x")).toBeNull();
    expect(screen.queryByTestId("ruler-y")).toBeNull();
  });

  it("show along the top and the left, numbered from the page's corner in the user's unit", () => {
    usePreferencesStore.getState().setRulers(true);
    render(<EditorViewport />);
    const top = screen.getByTestId("ruler-x");
    expect(screen.getByTestId("ruler-y")).toBeTruthy();
    const labels = () => [...top.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels()).toContain("0");
    expect(labels()).toContain("100");
    act(() => usePreferencesStore.getState().setUnit("in"));
    expect(labels()).toContain("1");
    expect(labels()).not.toContain("100");
  });

  it("mark the pointer's position as it moves over the page, and hide the mark when it leaves", () => {
    usePreferencesStore.getState().setRulers(true);
    render(<EditorViewport />);
    const mark = screen.getByTestId("ruler-x-mark") as unknown as SVGLineElement;
    expect(mark.style.display).toBe("none");
    fireEvent.pointerMove(svg(), { clientX: 120, clientY: 340 });
    expect(mark.style.display).toBe("");
    expect(mark.getAttribute("transform")).toBe("translate(120 0)");
    expect(screen.getByTestId("ruler-y-mark").getAttribute("transform")).toBe("translate(0 340)");
    fireEvent.pointerLeave(svg());
    expect(mark.style.display).toBe("none");
  });

  it("are not shown in the Preview view, which shows the sheet rather than the source page", () => {
    usePreferencesStore.getState().setRulers(true);
    useEditorStore.setState({ viewMode: "output" });
    render(<EditorViewport />);
    expect(screen.queryByTestId("ruler-x")).toBeNull();
  });
});
