// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "../../stores/preferences-store";
import { PANEL_ANIMATION_MS, PanelFrame } from "./PanelFrame";

const grids = () => usePreferencesStore.getState().prefs.workspace.layout.panels.find((p) => p.id === "grids");
const frame = () => (
  <PanelFrame
    panel={grids() ?? { id: "grids", position: "right", order: 1 }}
    position="right"
    orientation="vertical"
    regionCollapsed={false}
    info={<span>info</span>}
    actions={<button type="button">extra</button>}
  >
    <p>body</p>
  </PanelFrame>
);

beforeEach(() => {
  vi.useFakeTimers();
  usePreferencesStore.getState().resetToDefaults();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a panel's frame", () => {
  it("puts the panel's info after the title and its buttons before the menu", () => {
    render(frame());
    const header = screen.getByText("body").closest("section")?.querySelector("header");
    const texts = [...(header?.children ?? [])].map((c) => c.textContent);
    expect(texts.slice(1, 3)).toEqual(["Grids and pieces", "info"]);
    expect(texts.at(-2)).toBe("extra");
  });

  it("slides the body away before the panel folds, and back in when it opens", () => {
    const { rerender } = render(frame());
    fireEvent.click(screen.getByRole("button", { name: "Collapse Grids and pieces" }));
    expect(screen.getByText("body").parentElement?.className).toContain("panel-body-out");
    expect(grids()?.collapsed).toBeUndefined();
    act(() => vi.advanceTimersByTime(PANEL_ANIMATION_MS));
    expect(grids()?.collapsed).toBe(true);
    rerender(frame());
    fireEvent.click(screen.getByRole("button", { name: "Expand Grids and pieces" }));
    rerender(frame());
    expect(screen.getByText("body").parentElement?.className).toContain("panel-body-in");
  });
});
