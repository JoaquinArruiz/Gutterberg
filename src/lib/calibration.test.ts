import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

import { calibrationLabels, readingToOffset, saveCalibrationSheet } from "./calibration";

const A4 = { width_pt: 595.28, height_pt: 841.89 };

beforeEach(() => {
  invoke.mockReset();
  save.mockReset();
});

describe("readingToOffset", () => {
  it("is the reading itself, rounded to a hundredth and kept inside the engine's range", () => {
    expect(readingToOffset(1.5)).toBe(1.5);
    expect(readingToOffset(-0.5)).toBe(-0.5);
    expect(readingToOffset(0.333)).toBe(0.33);
    expect(readingToOffset(40)).toBe(10);
    expect(readingToOffset(-40)).toBe(-10);
  });
});

describe("saveCalibrationSheet", () => {
  it("writes the sheet where the user chose, with the page, the flip and the words", async () => {
    save.mockResolvedValue("/tmp/cal.pdf");
    invoke.mockResolvedValue(undefined);
    expect(await saveCalibrationSheet(A4, "short")).toBe("/tmp/cal.pdf");
    expect(invoke).toHaveBeenCalledWith("save_calibration_sheet", {
      outputPath: "/tmp/cal.pdf",
      page: A4,
      flip: "short",
      labels: calibrationLabels(),
    });
    expect(calibrationLabels().front).toBe("FRONT");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    save.mockResolvedValue(null);
    expect(await saveCalibrationSheet(A4, "long")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
