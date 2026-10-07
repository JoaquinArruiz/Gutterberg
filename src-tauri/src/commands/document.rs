use crate::state::AppState;
use card_core::render::DocumentInfo;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Open a PDF and return its page count and per-page sizes (points). The render
/// thread keeps the parsed document for later renders.
#[tauri::command]
pub async fn open_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<DocumentInfo, String> {
    let worker = state.worker(&app)?;
    let path = PathBuf::from(path);
    let opened = path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || worker.open(opened))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    state.set_path(path)?;
    Ok(info)
}
