// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../../i18n";
import { useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { StartScreen } from "./StartScreen";

const { openPdfDialog, openProjectDialog, addImagesDialog } = vi.hoisted(() => ({
  openPdfDialog: vi.fn(),
  openProjectDialog: vi.fn(),
  addImagesDialog: vi.fn(),
}));
vi.mock("../../lib/project-actions", () => ({ openPdfDialog, openProjectDialog, addImagesDialog }));

beforeEach(() => {
  openPdfDialog.mockReset();
  openProjectDialog.mockReset();
  addImagesDialog.mockReset();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.setState({ loading: false });
});
afterEach(() => {
  cleanup();
  applyLocale({ language: "en", decimal: "auto" });
});

describe("the start screen", () => {
  it("offers to open a PDF or a project, with their shortcuts", () => {
    render(<StartScreen />);
    expect(screen.getByRole("heading", { name: "Get started" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open PDF…/ }));
    expect(openPdfDialog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Open project…/ }));
    expect(openProjectDialog).toHaveBeenCalledTimes(1);
    expect(openProjectDialog).toHaveBeenLastCalledWith();
    expect(screen.getByRole("button", { name: /Open PDF…/ }).textContent).toContain("Ctrl+O");
    expect(screen.getByRole("button", { name: /Open project…/ }).textContent).toContain("Ctrl+Shift+O");
  });

  it("has the logo for each theme, which the theme in effect shows", () => {
    const { container } = render(<StartScreen />);
    expect(container.querySelectorAll("img.logo-for-light").length).toBe(1);
    expect(container.querySelectorAll("img.logo-for-dark").length).toBe(1);
    expect(screen.getAllByRole("img", { hidden: true })[0].getAttribute("alt")).toBe("Logo");
  });

  it("starts a project from images", () => {
    render(<StartScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Start from images" }));
    expect(addImagesDialog).toHaveBeenCalledTimes(1);
  });

  it("says there are no recent projects when there are none", () => {
    render(<StartScreen />);
    expect(screen.getByText("No recent projects")).toBeTruthy();
  });

  it("lists the recent projects, newest first, and opens the one clicked", () => {
    const { addRecentProject } = usePreferencesStore.getState();
    addRecentProject("/games/old.gtr");
    addRecentProject("/games/deck one/new.gtr");
    render(<StartScreen />);
    const list = within(screen.getByRole("region", { name: "Recent projects" }));
    const buttons = list.getAllByRole("button");
    expect(buttons.map((b) => b.querySelector("span")?.textContent)).toEqual(["new.gtr", "old.gtr"]);
    expect(buttons[0].textContent).toContain("/games/deck one");
    fireEvent.click(buttons[0]);
    expect(openProjectDialog).toHaveBeenCalledWith("/games/deck one/new.gtr");
  });

  it("tells projects with the same name apart by their folder", () => {
    const { addRecentProject } = usePreferencesStore.getState();
    addRecentProject("/a/deck.gtr");
    addRecentProject("/b/deck.gtr");
    render(<StartScreen />);
    expect(screen.getByText("/a")).toBeTruthy();
    expect(screen.getByText("/b")).toBeTruthy();
  });

  it("waits while a PDF is opening: nothing can be clicked and it says so", () => {
    usePreferencesStore.getState().addRecentProject("/x.gtr");
    useDocumentStore.setState({ loading: true });
    render(<StartScreen />);
    expect(screen.getByText("Opening…")).toBeTruthy();
    for (const button of screen.getAllByRole("button")) expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("points to the keyboard shortcuts", () => {
    render(<StartScreen />);
    expect(screen.getByText("Press ? to see the keyboard shortcuts.")).toBeTruthy();
  });

  it("is in Spanish when the language is", () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<StartScreen />);
    expect(screen.getByRole("heading", { name: "Para empezar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abrir PDF…/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Proyectos recientes" })).toBeTruthy();
  });
});
