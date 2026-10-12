// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { CalibrationDialog } from "./CalibrationDialog";

function typeNumber(input: HTMLElement, value: string) {
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  invoke.mockReset();
  save.mockReset();
  usePreferencesStore.getState().resetToDefaults();
  usePrintStore.getState().reset();
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("CalibrationDialog", () => {
  it("puts the two readings in the back offset", () => {
    const onClose = vi.fn();
    render(<CalibrationDialog open onClose={onClose} />);
    typeNumber(screen.getByRole("textbox", { name: /horizontal ruler/ }), "1.5");
    typeNumber(screen.getByRole("textbox", { name: /vertical ruler/ }), "-0.5");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const d = usePrintStore.getState().finish.duplex;
    expect([d.offsetXMm, d.offsetYMm]).toEqual([1.5, -0.5]);
    expect(onClose).toHaveBeenCalled();
  });

  it("saves the sheet for the planned sheet size and the chosen flip, and says where", async () => {
    const page = { width_pt: 612, height_pt: 792 };
    usePrintStore.setState({ sheets: [{ page } as never] });
    usePrintStore.getState().setDuplex({ flip: "short" });
    save.mockResolvedValue("/tmp/cal.pdf");
    invoke.mockResolvedValue(undefined);
    render(<CalibrationDialog open onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the sheet…" }));
    });
    expect(invoke).toHaveBeenCalledWith(
      "save_calibration_sheet",
      expect.objectContaining({ outputPath: "/tmp/cal.pdf", page, flip: "short" }),
    );
    expect(screen.getByRole("status").textContent).toContain("/tmp/cal.pdf");
  });

  it("shows the error when the sheet cannot be written", async () => {
    save.mockResolvedValue("/tmp/cal.pdf");
    invoke.mockRejectedValue({ code: "invalid_sheet", message: "bad", params: {} });
    render(<CalibrationDialog open onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save the sheet…" }));
    });
    expect(screen.getByRole("status").textContent?.length).toBeGreaterThan(0);
  });
});
