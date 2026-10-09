// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../../i18n";
import { DEFAULT_PREFERENCES } from "../../lib/preferences";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { useUpdateStore } from "../../stores/update-store";
import { PreferencesDialog } from "./PreferencesDialog";
import { UpdatesSection } from "./UpdatesSection";

const { checkForUpdates, installUpdate, restartNow, useAppVersion } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  restartNow: vi.fn(),
  useAppVersion: vi.fn(),
}));
vi.mock("../../lib/update-actions", () => ({ checkForUpdates, installUpdate, restartNow }));
vi.mock("../../lib/app-info", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/app-info")>()),
  useAppVersion,
}));

const state = (patch: Partial<ReturnType<typeof useUpdateStore.getState>>) =>
  act(() => useUpdateStore.setState({ status: "idle", update: null, progress: null, whatsNew: null, ...patch }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  checkForUpdates.mockReset();
  installUpdate.mockReset();
  restartNow.mockReset();
  useAppVersion.mockReset().mockReturnValue("1.1.0");
  usePreferencesStore.setState({ prefs: DEFAULT_PREFERENCES });
  useUiStore.setState({ prefsOpen: false, prefsSection: null });
  useUpdateStore.setState({ status: "idle", update: null, progress: null, whatsNew: null });
});
afterEach(() => {
  cleanup();
  applyLocale({ language: "en", decimal: "auto" });
});

describe("Preferences › Updates", () => {
  it("is in the navigation right after Help, with Experimental hidden while there is nothing experimental", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true));
    const names = screen.getAllByRole("button", {
      name: /^(General|Workspace|Preview|Appearance|AI|Help|Updates|Experimental|About)/,
    });
    const order = names.map((b) => b.textContent);
    expect(order.indexOf("Updates")).toBe(order.indexOf("Help") + 1);
    expect(order).not.toContain("Experimental");
  });

  it("opens on the section when asked for it, and shows the version you have", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true, "Updates"));
    expect(screen.getByTestId("current-version").textContent).toBe("You have 1.1.0.");
    expect(screen.getByText("Last checked: never")).toBeTruthy();
  });

  it("checks for updates on request", () => {
    render(<UpdatesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(checkForUpdates).toHaveBeenCalledWith(true);
  });

  it("shows a newer version with its notes as plain text, never as HTML", () => {
    state({
      status: "available",
      update: { version: "1.2.0", notes: "### Added\n\n- Faster <b>export</b>\n- <img src=x onerror=alert(1)>" },
    });
    const { container } = render(<UpdatesSection />);
    expect(screen.getByText("1.2.0 is available")).toBeTruthy();
    expect(screen.getByText("What's new in 1.2.0")).toBeTruthy();
    const notes = screen.getByTestId("release-notes");
    expect(notes.querySelectorAll("li")).toHaveLength(2);
    expect(notes.textContent).toContain("Faster <b>export</b>");
    expect(container.querySelector("b, img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download and install" }));
    expect(installUpdate).toHaveBeenCalled();
  });

  it("shows the download progress", () => {
    state({
      status: "downloading",
      update: { version: "1.2.0", notes: "" },
      progress: { done: 50, total: 200 },
    });
    render(<UpdatesSection />);
    expect(screen.getByText("Downloading the update… 25%")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Restart now and Later once installed", () => {
    state({ status: "ready", update: { version: "1.2.0", notes: "" } });
    render(<UpdatesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(restartNow).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("says when the check failed", () => {
    state({ status: "error" });
    render(<UpdatesSection />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't check for updates");
  });

  it("shows What's new for the version just installed", () => {
    state({ whatsNew: { version: "1.1.0", notes: "- Better" } });
    render(<UpdatesSection />);
    expect(screen.getByText("What's new in 1.1.0")).toBeTruthy();
    expect(screen.getByText("Better")).toBeTruthy();
  });

  it("saves Tell me about", () => {
    render(<UpdatesSection />);
    expect(screen.getByRole("radio", { name: /All updates/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Major versions only/ }));
    expect(usePreferencesStore.getState().prefs.updates.notify).toBe("major");
  });
});
