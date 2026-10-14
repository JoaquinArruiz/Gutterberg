// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../../i18n";
import { DEFAULT_PREFERENCES } from "../../lib/preferences";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { PreferencesDialog } from "./PreferencesDialog";

const { loadAppInfo, loadLog, openExternalLink, writeText } = vi.hoisted(() => ({
  loadAppInfo: vi.fn(),
  loadLog: vi.fn(),
  openExternalLink: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("../../lib/app-info", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/app-info")>()),
  loadAppInfo,
  loadLog,
}));
vi.mock("../../lib/external-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/external-links")>()),
  openExternalLink,
}));

const INFO = { name: "Gutterberg", version: "1.0.0", os: "Windows 11 (x86_64)", language: "en", pdfium: "8086" };

async function openHelp() {
  await act(async () => useUiStore.getState().setPrefsOpen(true, "Help"));
}
const section = (name: string) => screen.getByText(name).closest("div")?.parentElement as HTMLElement;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  loadAppInfo.mockReset().mockResolvedValue(INFO);
  loadLog.mockReset().mockResolvedValue("2026-10-12 14:03:09Z  start  Gutterberg 0.10.0 on macos aarch64\n");
  openExternalLink.mockReset().mockResolvedValue("opened");
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  usePreferencesStore.setState({ prefs: DEFAULT_PREFERENCES });
  useUiStore.setState({ prefsOpen: false, prefsSection: null, welcomeOpen: false, hintsHeld: false });
});
afterEach(() => {
  cleanup();
  applyLocale({ language: "en", decimal: "auto" });
});

describe("Preferences › Help", () => {
  it("opens from its own button in the navigation", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText("Welcome tour")).toBeTruthy();
    expect(screen.getByText("Found a bug?")).toBeTruthy();
  });

  it("has the four groups, in order", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const titles = ["Welcome tour", "Help tips", "Keyboard shortcuts", "Found a bug?"].map((t) => screen.getByText(t));
    for (let i = 1; i < titles.length; i++)
      expect(titles[i - 1].compareDocumentPosition(titles[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("replays the welcome tour, stepping out of the way", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    fireEvent.click(screen.getByRole("button", { name: "Replay welcome tour" }));
    expect(useUiStore.getState().welcomeOpen).toBe(true);
    expect(useUiStore.getState().prefsOpen).toBe(false);
  });

  it("brings the help tips back, and says how many were hidden", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const button = screen.getByRole("button", { name: "Show closed tips again" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No help tip is closed.")).toBeTruthy();
    act(() => {
      usePreferencesStore.getState().dismissHint("live-preview-output");
      usePreferencesStore.getState().dismissHint("freeform-tool");
    });
    expect(screen.getByText(/2 help tips are hidden/)).toBeTruthy();
    fireEvent.click(button);
    expect(usePreferencesStore.getState().prefs.help.dismissedHints).toEqual({});
  });

  it("has a Show help tips switch, on by default, at the top of the field", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const tips = screen.getByRole("switch", { name: "Show help tips" });
    expect(tips.getAttribute("aria-checked")).toBe("true");
    const button = screen.getByRole("button", { name: "Show closed tips again" });
    expect(tips.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("turns the help tips off and on, and keeps the closed ones", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    act(() => usePreferencesStore.getState().dismissHint("freeform-tool"));
    fireEvent.click(screen.getByRole("switch", { name: "Show help tips" }));
    expect(usePreferencesStore.getState().prefs.help.tipsOn).toBe(false);
    expect(usePreferencesStore.getState().prefs.help.dismissedHints).toEqual({ "freeform-tool": 1 });
    expect(screen.getByText(/Help tips are off/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Show help tips" }));
    expect(usePreferencesStore.getState().prefs.help.tipsOn).toBe(true);
  });

  it("shows closed tips again only when some were closed and the switch is on", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const button = screen.getByRole("button", { name: "Show closed tips again" });
    expect(button.hasAttribute("disabled")).toBe(true);
    act(() => usePreferencesStore.getState().dismissHint("freeform-tool"));
    expect(button.hasAttribute("disabled")).toBe(false);
    act(() => usePreferencesStore.getState().setTipsOn(false));
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("still replays the welcome tour with the tips off", async () => {
    usePreferencesStore.getState().setTipsOn(false);
    render(<PreferencesDialog />);
    await openHelp();
    fireEvent.click(screen.getByRole("button", { name: "Replay welcome tour" }));
    expect(useUiStore.getState().welcomeOpen).toBe(true);
  });

  it("no longer has the help tips under General", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "General" as never));
    expect(screen.queryByRole("button", { name: "Show closed tips again" })).toBeNull();
  });

  it("lists the keyboard shortcuts right in the section, and says ? opens them anywhere", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const list = screen.getByTestId("help-shortcuts");
    expect(within(list).getByText("Open Preferences")).toBeTruthy();
    expect(list.querySelectorAll("[data-shortcut]").length).toBeGreaterThan(10);
    expect(screen.getByText("Press ? at any time to open this list.")).toBeTruthy();
  });

  it("says what to put in a bug report", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const text = screen.getByText("Found a bug?").closest("div")?.parentElement?.textContent ?? "";
    for (const part of [
      "which version you use and on which system",
      "step by step",
      "what you expected",
      "a way around it",
      "the log, if the app closed by itself",
    ])
      expect(text).toContain(part);
    // The issue form has no field for attachments, so the app does not ask for files either.
    expect(text).not.toContain("screenshot");
  });

  it("copies the app info, and says so", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const line = "Gutterberg 1.0.0 · Windows 11 (x86_64) · Language: en · pdfium 8086";
    expect((await screen.findByTestId("app-info")).textContent).toBe(line);
    fireEvent.click(screen.getByRole("button", { name: "Copy app info" }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith(line);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("copies the log, and says so", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    fireEvent.click(await screen.findByRole("button", { name: "Copy log" }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("2026-10-12 14:03:09Z  start  Gutterberg 0.10.0 on macos aarch64\n");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    // The app info button is separate and untouched.
    expect(screen.getByRole("button", { name: "Copy app info" })).toBeTruthy();
  });

  it("says there is no log yet instead of copying nothing", async () => {
    loadLog.mockResolvedValue("  \n");
    render(<PreferencesDialog />);
    await openHelp();
    fireEvent.click(await screen.findByRole("button", { name: "Copy log" }));
    expect(await screen.findByText("There is no log yet.")).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says when the log could not be read or copied", async () => {
    loadLog.mockRejectedValue(new Error("no app"));
    render(<PreferencesDialog />);
    await openHelp();
    fireEvent.click(await screen.findByRole("button", { name: "Copy log" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't read or copy the log");
    loadLog.mockResolvedValue("x\n");
    writeText.mockRejectedValue(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("Couldn't read or copy the log");
  });

  it("explains what the log holds and to look it over before sending it", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const note = await screen.findByText(/plain text about what the app did/);
    expect(note.textContent).toContain("does not include your PDFs");
    expect(note.textContent).toContain("look it over");
  });

  it("says when it could not copy", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<PreferencesDialog />);
    await openHelp();
    await screen.findByTestId("app-info");
    fireEvent.click(screen.getByRole("button", { name: "Copy app info" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't copy");
  });

  it("reports on GitHub through the link that asks first, with the version and system in the address", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    await screen.findByTestId("app-info");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Report on GitHub" }));
    });
    expect(openExternalLink).toHaveBeenCalledTimes(1);
    const url = new URL(openExternalLink.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://github.com/JoaquinArruiz/Gutterberg/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("version")).toBe("1.0.0");
    expect(url.searchParams.get("os")).toBe("Windows 11 (x86_64)");
  });

  it("warns when the browser could not be opened", async () => {
    openExternalLink.mockRejectedValue(new Error("no browser"));
    render(<PreferencesDialog />);
    await openHelp();
    await screen.findByTestId("app-info");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Report on GitHub" }));
    });
    expect((await screen.findByRole("alert")).textContent).toContain("⚠");
  });

  it("can neither copy nor report while the app info is not known (outside the app window)", async () => {
    loadAppInfo.mockRejectedValue(new Error("no app"));
    render(<PreferencesDialog />);
    await openHelp();
    expect(screen.getByRole("button", { name: "Copy app info" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Report on GitHub" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("app-info").textContent).toContain("only available in the app window");
  });

  it("shows a Discord button with its logo, switched off, saying it is coming soon", async () => {
    render(<PreferencesDialog />);
    await openHelp();
    const discord = screen.getByRole("button", { name: /Discord/ });
    expect(discord.hasAttribute("disabled")).toBe(true);
    expect(discord.textContent).toContain("Coming soon");
    expect(discord.querySelector("svg title")?.textContent).toBe("Discord");
    fireEvent.click(discord);
    expect(openExternalLink).not.toHaveBeenCalled();
  });

  it("is in Spanish when the language is", async () => {
    applyLocale({ language: "es", decimal: "auto" });
    loadAppInfo.mockResolvedValue({ ...INFO, language: "es" });
    render(<PreferencesDialog />);
    await openHelp();
    expect(screen.getByText("¿Encontraste un error?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar datos de la aplicación" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Discord/ }).textContent).toContain("Próximamente");
    expect(section("Recorrido de bienvenida")).toBeTruthy();
  });
});
