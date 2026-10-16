// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { EditorToolbar } from "./EditorToolbar";
import { StatusBar } from "./StatusBar";

const TITLES = [
  "Select (V)",
  "Grid tool (G)",
  "Piece tool (C)",
  "Pan (H)",
  "Snap to the page and to other pieces while dragging (hold Ctrl/Cmd to drag without it)",
  "Stick to edges in the artwork while dragging (hold Ctrl/Cmd to drag without it)",
  "Rulers and guides (Ctrl/Cmd+R)",
  "Undo (Ctrl+Z)",
  "Redo (Shift+Ctrl+Z)",
  "Zoom out (-)",
  "Zoom in (+)",
  "Fit page (0)",
];
const A4 = { width_pt: 595.2756, height_pt: 841.8898 };

beforeEach(() => {
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([], 0);
  useUiStore.getState().setStage("cards");
});
afterEach(cleanup);

describe("the toolbar with nothing open", () => {
  it("shows only File, the panels menu, Help and Preferences", () => {
    render(<EditorToolbar />);
    expect(screen.getByRole("button", { name: /^File/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Panels/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preferences" })).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    for (const title of TITLES) expect(screen.queryByTitle(title), title).toBeNull();
    expect(screen.queryByText("Export PDF")).toBeNull();
  });

  it("leaves the status bar empty under the start screen", () => {
    render(<StatusBar />);
    expect(screen.queryByText("No document")).toBeNull();
  });
});

describe("the toolbar with a document open", () => {
  it("shows the tabs, tools, undo and redo, zoom, views and Export PDF", () => {
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/demo.pdf", pages: [A4], hash: "" }], 0);
    useLayoutStore.getState().resetDocument(1);
    render(<EditorToolbar />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Source",
      "Print",
      "Original",
      "Preview",
      "Split",
    ]);
    for (const title of TITLES) expect(screen.getByTitle(title), title).toBeTruthy();
    expect(screen.getByText("Export PDF")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preferences" })).toBeTruthy();
  });
});

describe("the precision aids", () => {
  it("are switches in their own group after the tools, that remember their state", () => {
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/demo.pdf", pages: [A4], hash: "" }], 0);
    useLayoutStore.getState().resetDocument(1);
    render(<EditorToolbar />);
    const group = screen.getByRole("group", { name: "Precision aids" });
    const [magnet, edges, rulers] = within(group).getAllByRole("button");
    expect(magnet.getAttribute("aria-pressed")).toBe("true");
    expect(edges.getAttribute("aria-pressed")).toBe("true");
    expect(rulers.getAttribute("aria-pressed")).toBe("false");
    expect(edges.getAttribute("data-hint-target")).toBe("sticky-edges-button");
    fireEvent.click(edges);
    fireEvent.click(rulers);
    expect(usePreferencesStore.getState().prefs.editor).toMatchObject({ snap: true, snapEdges: false, rulers: true });
    expect(edges.getAttribute("aria-pressed")).toBe("false");
    expect(rulers.getAttribute("aria-pressed")).toBe("true");
  });
});
