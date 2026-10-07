use crate::state::AppState;
use card_core::geometry::Rect;
use card_core::render::{render_page_png, render_region_png};
use tauri::{ipc::Response, AppHandle, State};

/// Render a page (0-based) to a PNG of the given pixel width. Used for both
/// the viewport and thumbnails.
#[tauri::command]
pub async fn render_page(
    app: AppHandle,
    state: State<'_, AppState>,
    page_index: usize,
    width_px: u32,
) -> Result<Response, String> {
    let pdfium = state.pdfium(&app)?;
    let path = state.path()?;
    let png = render_page_png(&pdfium, &path, page_index, width_px).map_err(|e| e.to_string())?;
    Ok(Response::new(png))
}

/// Render only `region` (normalized) of a page, at the scale where the whole
/// page would be `full_width_px` wide. Used by the magnifier.
#[tauri::command]
pub async fn render_region(
    app: AppHandle,
    state: State<'_, AppState>,
    page_index: usize,
    region: Rect,
    full_width_px: u32,
) -> Result<Response, String> {
    let pdfium = state.pdfium(&app)?;
    let path = state.path()?;
    let png = render_region_png(&pdfium, &path, page_index, region, full_width_px)
        .map_err(|e| e.to_string())?;
    Ok(Response::new(png))
}
