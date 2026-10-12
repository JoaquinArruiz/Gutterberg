// The duplex calibration sheet: the Rust engine writes the two-page PDF (`card_core::calibration`); this file asks
// where to save it and passes the words in the user's language.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t } from "../i18n";
import { type Flip, MAX_DUPLEX_OFFSET_MM } from "./finish";
import type { PageSize } from "./tauri";
import { mmToPt } from "./units";

/** The sheet size to calibrate for when no sheet has been planned yet (A4 portrait). */
export const FALLBACK_SHEET: PageSize = { width_pt: mmToPt(210), height_pt: mmToPt(297) };

/** Mirrors `card_core::calibration::CalibrationLabels`. */
export type CalibrationLabels = { title: string; front: string; back: string; actual_size: string };

export function calibrationLabels(): CalibrationLabels {
  return {
    title: t("print.duplex.calibration.label.title"),
    front: t("print.duplex.calibration.label.front"),
    back: t("print.duplex.calibration.label.back"),
    actual_size: t("print.duplex.calibration.label.actualSize"),
  };
}

/**
 * A reading from a ruler of the sheet as the back offset. The rulers are drawn in the back sheet's own frame, with
 * right and down positive like the offset fields, so the number is the offset; only the range is limited.
 */
export const readingToOffset = (mm: number) =>
  Math.min(MAX_DUPLEX_OFFSET_MM, Math.max(-MAX_DUPLEX_OFFSET_MM, Math.round(mm * 100) / 100));

/** Asks where to save the sheet and writes it. Resolves to the path, or null when the user cancelled. */
export async function saveCalibrationSheet(page: PageSize, flip: Flip): Promise<string | null> {
  const outputPath = await save({
    defaultPath: `${t("print.duplex.calibration.fileName")}.pdf`,
    filters: [{ name: t("files.pdfFilter"), extensions: ["pdf"] }],
  });
  if (!outputPath) return null;
  await invoke("save_calibration_sheet", { outputPath, page, flip, labels: calibrationLabels() });
  return outputPath;
}
