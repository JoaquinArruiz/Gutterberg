use card_core::geometry::PageSize;
use card_core::layout::{calculate_layout, GridLayout, LayoutResult};
use card_core::ErrorInfo;

/// Card placements for the output preview. Thin wrapper over the same
/// `calculate_layout` the exporter uses, so preview and export cannot disagree.
#[tauri::command]
pub fn compute_layout(source_page: PageSize, grid: GridLayout) -> Result<LayoutResult, ErrorInfo> {
    Ok(calculate_layout(source_page, &grid, None)?)
}
