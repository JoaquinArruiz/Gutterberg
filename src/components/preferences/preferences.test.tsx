// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTERNAL_LINKS } from "../../lib/external-links";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { PreferencesDialog } from "./PreferencesDialog";

const { getName, getVersion, openExternalLink } = vi.hoisted(() => ({
  getName: vi.fn(),
  getVersion: vi.fn(),
  openExternalLink: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getName, getVersion }));
vi.mock("../../lib/external-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/external-links")>()),
  openExternalLink,
}));

const nav = () => screen.getByRole("navigation", { name: "Preferences sections" });
const sectionButtons = () => within(nav()).getAllByRole("button");

async function openPreferences(section?: "About") {
  await act(async () => useUiStore.getState().setPrefsOpen(true, section));
}

beforeEach(() => {
  // jsdom has no <dialog> behaviour: mark it open as showModal would.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  getName.mockResolvedValue("Gutterberg");
  getVersion.mockResolvedValue("1.2.3");
  openExternalLink.mockReset();
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.setState({ prefsOpen: false, prefsSection: null });
});
afterEach(() => cleanup());

describe("the Preferences sections", () => {
  it("lists the sections in order, each with an icon, and About last", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    const buttons = sectionButtons();
    expect(buttons.map((b) => b.textContent)).toEqual([
      "General",
      "Workspace",
      "Preview",
      "Appearance",
      "AI Mode (experimental)",
      "Help",
      "About",
    ]);
    // Every one has its icon: an svg from lucide, or the app's own icon for About.
    for (const b of buttons.slice(0, 6)) expect(b.querySelector("svg")).toBeTruthy();
    expect(buttons[6].querySelector("svg")).toBeNull();
    expect(buttons[6].querySelector("img")).toBeTruthy();
    // The AI icon is the spark, in the AI colour.
    expect(buttons[4].querySelector("svg")?.getAttribute("class")).toContain("--ai");
  });

  it("keeps About alone at the bottom, after a spacer", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    const buttons = sectionButtons();
    const spacer = buttons[6].previousElementSibling;
    expect(spacer?.tagName).toBe("DIV");
    expect(spacer?.className).toContain("flex-1");
    expect(buttons[5].nextElementSibling).toBe(spacer);
  });

  it("marks the open section and switches on click", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("button", { name: "Appearance" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
  });

  it("shows the Workspace layout of both tabs", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByText("Layout of the Source tab")).toBeTruthy();
    expect(screen.getByText("Layout of the Print tab")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Piece library panel position" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Print settings panel position" })).toBeTruthy();
  });
});

describe("About", () => {
  it("shows the app's name and version, who made it, and the two links", async () => {
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(await screen.findByText("Gutterberg")).toBeTruthy();
    expect(screen.getByTestId("app-version").textContent).toBe("Version 1.2.3");
    expect(screen.getByText("Created by Joaquin Arruiz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "LinkedIn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    // Each carries its logo, drawn inline and hidden from screen readers (the button's text names it).
    expect(screen.getByRole("button", { name: "LinkedIn" }).querySelector("svg path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" }).querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("opens nothing by itself: a link goes through the confirmation with its exact address", async () => {
    openExternalLink.mockResolvedValue("cancelled");
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(openExternalLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(openExternalLink).toHaveBeenLastCalledWith(EXTERNAL_LINKS.linkedin);
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    expect(openExternalLink).toHaveBeenLastCalledWith(EXTERNAL_LINKS.github);
    expect(openExternalLink).toHaveBeenCalledTimes(2);
  });

  it("says so when the browser could not be opened", async () => {
    openExternalLink.mockRejectedValue(new Error("no browser"));
    render(<PreferencesDialog />);
    await openPreferences("About");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "GitHub" })));
    expect(screen.getByRole("alert").textContent).toContain("The link could not be opened.");
  });

  it("still shows who made it outside the app window, where there is no version to ask for", async () => {
    getVersion.mockRejectedValue(new Error("no tauri"));
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(screen.getByText("Created by Joaquin Arruiz")).toBeTruthy();
    expect(screen.queryByTestId("app-version")).toBeNull();
  });
});
