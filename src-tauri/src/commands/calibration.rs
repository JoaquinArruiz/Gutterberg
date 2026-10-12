use card_core::calibration::{write_calibration_pdf, CalibrationLabels};
use card_core::finish::Flip;
use card_core::geometry::PageSize;
use card_core::ErrorInfo;
use std::path::PathBuf;

use crate::state::internal;

/// Writes the duplex calibration sheet (a front and a back, see `card_core::calibration`) for
/// a sheet of `page` turned over `flip`.
#[tauri::command]
pub async fn save_calibration_sheet(
    output_path: String,
    page: PageSize,
    flip: Flip,
    labels: CalibrationLabels,
) -> Result<(), ErrorInfo> {
    let output = PathBuf::from(output_path);
    tauri::async_runtime::spawn_blocking(move || {
        write_calibration_pdf(&output, &page, flip, &labels)
    })
    .await
    .map_err(internal)??;
    Ok(())
}
