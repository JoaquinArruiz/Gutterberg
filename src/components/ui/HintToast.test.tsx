// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HINTS } from "../../lib/hints";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { HintToast } from "./HintToast";

beforeEach(() => {
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.setState({ prefsOpen: false, prefsSection: null });
});
afterEach(cleanup);

const dismissed = () => usePreferencesStore.getState().prefs.help.dismissedHints;

describe("HintToast", () => {
  it("shows a single-step hint from the catalog without a stepper, and runs its button", () => {
    render(<HintToast hint="live-preview-output" />);
    const toast = screen.getByTestId("hint-live-preview-output");
    expect(toast.textContent).toContain(HINTS["live-preview-output"].steps[0].text);
    expect(screen.queryByRole("button", { name: "Next tip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Preferences" }));
    expect(useUiStore.getState().prefsOpen).toBe(true);
    expect(useUiStore.getState().prefsSection).toBe("Preview");
  });

  it("steps forwards and back with the buttons, ending in Done", () => {
    render(<HintToast hint="print-stage-intro" />);
    const total = HINTS["print-stage-intro"].steps.length;
    expect(screen.getByText(`1 / ${total}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous tip" })).toHaveProperty("disabled", true);
    for (let i = 1; i < total; i++) fireEvent.click(screen.getByRole("button", { name: "Next tip" }));
    expect(screen.getByText(`${total} / ${total}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous tip" }));
    expect(screen.getByText(`${total - 1} / ${total}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next tip" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("hint-print-stage-intro")).toBeNull();
    expect(dismissed()).toEqual({ "print-stage-intro": 1 });
  });

  it("steps with the arrow keys and closes with Escape", () => {
    render(<HintToast hint="print-stage-intro" />);
    const toast = screen.getByTestId("hint-print-stage-intro");
    fireEvent.keyDown(toast, { key: "ArrowRight" });
    expect(screen.getByText(`2 / ${HINTS["print-stage-intro"].steps.length}`)).toBeTruthy();
    fireEvent.keyDown(toast, { key: "ArrowLeft" });
    expect(screen.getByText(`1 / ${HINTS["print-stage-intro"].steps.length}`)).toBeTruthy();
    fireEvent.keyDown(toast, { key: "Escape" });
    expect(screen.queryByTestId("hint-print-stage-intro")).toBeNull();
    expect(dismissed()).toEqual({ "print-stage-intro": 1 });
  });

  it("closing one hint does not close the other live-preview hint", () => {
    render(
      <>
        <HintToast hint="live-preview-output" />
        <HintToast hint="live-preview-sheets" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    expect(dismissed()).toEqual({ "live-preview-output": 1 });
  });

  it("shows hints that want to appear together one after the other, in catalog order", () => {
    // Mounted in the opposite order to the catalog: the catalog still decides.
    render(
      <>
        <HintToast hint="print-stage-intro" />
        <HintToast hint="live-preview-sheets" />
      </>,
    );
    expect(screen.queryByTestId("hint-print-stage-intro")).toBeNull();
    expect(screen.getByTestId("hint-live-preview-sheets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByTestId("hint-live-preview-sheets")).toBeNull();
    expect(screen.getByTestId("hint-print-stage-intro")).toBeTruthy();
  });

  it("shows the next hint when the first stops being rendered", () => {
    const { rerender } = render(
      <>
        <HintToast hint="live-preview-output" />
        <HintToast hint="print-stage-intro" />
      </>,
    );
    expect(screen.queryByTestId("hint-print-stage-intro")).toBeNull();
    rerender(<HintToast hint="print-stage-intro" />);
    expect(screen.getByTestId("hint-print-stage-intro")).toBeTruthy();
  });

  it("stays hidden after a dismissal and returns after Reset help tips", () => {
    render(<HintToast hint="live-preview-output" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => usePreferencesStore.getState().resetHints());
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
  });

  it("shows again when its catalog version is newer than the dismissal", () => {
    act(() =>
      usePreferencesStore.setState((s) => ({
        prefs: { ...s.prefs, help: { dismissedHints: { "live-preview-output": 0 } } },
      })),
    );
    render(<HintToast hint="live-preview-output" />);
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
  });
});
