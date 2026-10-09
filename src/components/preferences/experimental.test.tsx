// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "../../lib/preferences";
import { useExperimental, usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { ExperimentalSection } from "./ExperimentalSection";
import { PreferencesDialog } from "./PreferencesDialog";

// One experimental feature, so the section shows up.
vi.mock("../../lib/experimental", () => {
  const EXPERIMENTAL = [
    { id: "alpha", title: "experimental.features.alpha.title", text: "experimental.features.alpha.text" },
  ];
  return {
    EXPERIMENTAL,
    normalizeExperimental: (raw: unknown) => {
      const flags: Record<string, boolean> = {};
      const r = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
      for (const { id } of EXPERIMENTAL) if (typeof r[id] === "boolean") flags[id] = r[id] as boolean;
      return flags;
    },
  };
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  usePreferencesStore.setState({ prefs: DEFAULT_PREFERENCES });
  useUiStore.setState({ prefsOpen: false, prefsSection: null });
});
afterEach(cleanup);

describe("Preferences › Experimental", () => {
  it("appears after Updates when a feature is experimental", async () => {
    render(<PreferencesDialog />);
    await act(async () => useUiStore.getState().setPrefsOpen(true));
    const order = screen
      .getAllByRole("button", { name: /^(Help|Updates|Experimental|About)/ })
      .map((b) => b.textContent);
    expect(order).toEqual(["Help", "Updates", "Experimental", "About"]);
  });

  it("lists a switch per feature, off until switched on", () => {
    render(<ExperimentalSection />);
    expect(screen.getByText("May change or disappear in a later version. Off unless you switch them on.")).toBeTruthy();
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(usePreferencesStore.getState().prefs.experimental.flags).toEqual({ alpha: true });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("is read by the code with useExperimental", () => {
    const { result } = renderHook(() => useExperimental("alpha"));
    expect(result.current).toBe(false);
    act(() => usePreferencesStore.getState().setExperimental("alpha", true));
    expect(result.current).toBe(true);
  });
});
