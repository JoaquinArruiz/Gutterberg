// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import refractionHubLogo from "../../../assets/brand/refractionhub.svg";
import { EXTERNAL_LINKS } from "../../lib/external-links";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { useUpdateStore } from "../../stores/update-store";
import { PreferencesDialog } from "./PreferencesDialog";

const { getName, getVersion, openExternalLink, licenseTexts } = vi.hoisted(() => ({
  getName: vi.fn(),
  getVersion: vi.fn(),
  openExternalLink: vi.fn(),
  licenseTexts: vi.fn(),
}));
vi.mock("../../lib/licenses", () => ({ licenseTexts }));
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
  licenseTexts.mockReset().mockResolvedValue({
    app: "PolyForm Noncommercial License 1.0.0\nRequired Notice: Copyright Joaquín Arruiz",
    third_party: "Third-party licenses\n\nreact 19: MIT License",
  });
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.setState({ prefsOpen: false, prefsSection: null, prefsPulse: null });
  useUpdateStore.setState({ store: false });
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
      "Layout",
      "Display",
      "AI Mode (experimental)",
      "Help",
      "Updates",
      "About",
    ]);
    // Every one has its icon: an svg from lucide, or the app's own icon for About.
    for (const b of buttons.slice(0, 7)) expect(b.querySelector("svg")).toBeTruthy();
    expect(buttons[7].querySelector("svg")).toBeNull();
    expect(buttons[7].querySelector("img")).toBeTruthy();
    // The AI icon is the spark, in the AI colour.
    expect(buttons[4].querySelector("svg")?.getAttribute("class")).toContain("--ai");
  });

  it("has no Updates section in a Microsoft Store copy, even when a link asks for it", async () => {
    useUpdateStore.setState({ store: true });
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Updates"));
    expect(sectionButtons().map((b) => b.textContent)).not.toContain("Updates");
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("true");
  });

  it("keeps About alone at the bottom, after a spacer", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    const buttons = sectionButtons();
    const spacer = buttons[7].previousElementSibling;
    expect(spacer?.tagName).toBe("DIV");
    expect(spacer?.className).toContain("flex-1");
    expect(buttons[6].nextElementSibling).toBe(spacer);
  });

  it("marks the open section and switches on click", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("button", { name: "Display" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
  });

  it("keeps only the views in Workspace", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByText("Visible views")).toBeTruthy();
    expect(screen.getByText("Default view")).toBeTruthy();
    expect(screen.queryByText("Layout of the Source tab")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Invert rulers" })).toBeNull();
  });

  it("shows the layout of both tabs, the panel memory and the reset under Layout", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    expect(screen.getByText("Layout of the Source tab")).toBeTruthy();
    expect(screen.getByText("Layout of the Print tab")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Piece library panel position" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Print settings panel position" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Remember panel sizes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset workspace layout" })).toBeTruthy();
  });

  it("puts the theme, Live preview and the rulers under Display", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Live preview" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Invert rulers" })).toBeTruthy();
  });

  it("keeps the longer explanations behind an info tip", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    // The note is the info button's description, not a paragraph on the page.
    const note = screen.getByText(/Only changes how lengths are shown and typed/);
    expect(note.className).toContain("sr-only");
  });

  it("has Invert rulers, off by default", async () => {
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const invert = screen.getByRole("switch", { name: "Invert rulers" });
    expect(invert.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(invert);
    expect(usePreferencesStore.getState().prefs.editor.invertRulers).toBe(true);
  });
});

describe("a link to a setting", () => {
  it("opens its section with the setting pulsing, and stops when the pulse ends", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Display", "livePreview"));
    expect(screen.getByRole("button", { name: "Display" }).getAttribute("aria-current")).toBe("true");
    const field = screen.getByRole("radiogroup", { name: "Live preview" }).closest("[data-pulse]") as HTMLElement;
    expect(field.className).toContain("prefs-pulse");
    // Only the setting the link named.
    expect(document.querySelectorAll("[data-pulse]").length).toBe(1);
    // jsdom has no AnimationEvent, so React listens for the prefixed name.
    fireEvent(field, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(useUiStore.getState().prefsPulse).toBeNull();
    expect(field.className).not.toContain("prefs-pulse");
  });

  it("pulses the help tips switch when a tip's link points there", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Help", "helpTips"));
    const field = screen.getByRole("switch", { name: "Show help tips" }).closest("[data-pulse]");
    expect(field?.className).toContain("prefs-pulse");
  });

  it("pulses nothing when Preferences opens without a link, or closes", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Display"));
    expect(document.querySelector("[data-pulse]")).toBeNull();
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Display", "livePreview"));
    await act(async () => useUiStore.getState().setPrefsOpen(false));
    expect(useUiStore.getState().prefsPulse).toBeNull();
  });
});

describe("About", () => {
  it("shows the app's name and version, who made it, and the three links", async () => {
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(await screen.findByText("Gutterberg")).toBeTruthy();
    expect(screen.getByTestId("app-version").textContent).toBe("Version 1.2.3");
    expect(screen.getByText("Created by Joaquin Arruiz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "LinkedIn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "RefractionHub" })).toBeTruthy();
    // Each carries its logo, drawn inline and hidden from screen readers (the button's text names it).
    expect(screen.getByRole("button", { name: "LinkedIn" }).querySelector("svg path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" }).querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    // RefractionHub is not the author's own page: it sits in a group of its own, after a divider.
    const org = screen.getByTestId("about-org-link");
    expect(within(org).getByRole("button", { name: "RefractionHub" })).toBeTruthy();
    expect(within(org).queryByRole("button", { name: "LinkedIn" })).toBeNull();
    expect(within(org).queryByRole("button", { name: "GitHub" })).toBeNull();
    expect(org.className).toContain("border-l");
    // RefractionHub's logo is its own image, not a text-coloured icon: decorative, with the name next to it.
    const logo = screen.getByRole("button", { name: "RefractionHub" }).querySelector("img");
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.getAttribute("src")).toBe(refractionHubLogo); // the master in assets/brand, not another image
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
    fireEvent.click(screen.getByRole("button", { name: "RefractionHub" }));
    expect(openExternalLink).toHaveBeenLastCalledWith("https://github.com/RefractionHub");
    expect(openExternalLink).toHaveBeenCalledTimes(3);
  });

  it("links the download page and the changelog, and shows this version's notes from the changelog", async () => {
    getVersion.mockResolvedValue("1.2.1");
    openExternalLink.mockResolvedValue("cancelled");
    render(<PreferencesDialog />);
    await openPreferences("About");
    fireEvent.click(await screen.findByRole("button", { name: "Download page" }));
    expect(openExternalLink).toHaveBeenLastCalledWith("https://joaquinarruiz.com.ar/projects/gutterberg");
    fireEvent.click(screen.getByRole("button", { name: "Full changelog" }));
    expect(openExternalLink).toHaveBeenLastCalledWith(EXTERNAL_LINKS.changelog);
    expect(screen.queryByTestId("release-notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What's new in 1.2.1" }));
    expect(screen.getByTestId("release-notes").textContent).toContain("safety release");
  });

  it("sends the Microsoft Store copy to its Store page, where it is updated", async () => {
    useUpdateStore.setState({ store: true });
    openExternalLink.mockResolvedValue("cancelled");
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(screen.queryByRole("button", { name: "Download page" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Microsoft Store page" }));
    expect(openExternalLink).toHaveBeenLastCalledWith("https://apps.microsoft.com/detail/9NLQ61KCDSKZ");
  });

  it("states the terms in a line and shows the license and the third-party notices on request", async () => {
    render(<PreferencesDialog />);
    await openPreferences("About");
    expect(screen.getByText(/Free for personal and noncommercial use/).textContent).toContain(
      "contact joaquinarruiz@gmail.com",
    );
    expect(screen.queryByTestId("license-text")).toBeNull();
    expect(licenseTexts).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Gutterberg license" })));
    expect((screen.getByTestId("license-text") as HTMLTextAreaElement).value).toContain(
      "PolyForm Noncommercial License 1.0.0",
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Third-party licenses" })));
    expect((screen.getByTestId("license-text") as HTMLTextAreaElement).value).toContain("react 19: MIT License");
    // The same button hides it again, and the texts are only asked for once.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Third-party licenses" })));
    expect(screen.queryByTestId("license-text")).toBeNull();
    expect(licenseTexts).toHaveBeenCalledTimes(1);
  });

  it("says so when the license text cannot be loaded", async () => {
    licenseTexts.mockRejectedValue(new Error("no app"));
    render(<PreferencesDialog />);
    await openPreferences("About");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Gutterberg license" })));
    expect(screen.getByRole("alert").textContent).toContain("The license text could not be loaded.");
    expect(screen.queryByTestId("license-text")).toBeNull();
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

describe("a dialog inside Preferences", () => {
  it("closing the AI Mode warning (Okay or Cancel) leaves Preferences open, to type the key next", async () => {
    // As a browser does: close() fires a "close" event on that dialog.
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    render(<PreferencesDialog />);
    await openPreferences();
    fireEvent.click(screen.getByRole("button", { name: "AI Mode (experimental)" }));
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    const warning = screen.getByTestId("ai-experimental");
    fireEvent.click(within(warning).getByRole("button", { name: "Okay" }));
    expect(usePreferencesStore.getState().prefs.ai.enabled).toBe(true);
    expect(useUiStore.getState().prefsOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: "Preferences" }).hasAttribute("open")).toBe(true);
    // Turned off and on again, then Cancel: still open.
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    fireEvent.click(within(screen.getByTestId("ai-experimental")).getByRole("button", { name: "Cancel" }));
    expect(useUiStore.getState().prefsOpen).toBe(true);
  });
});
