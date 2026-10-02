use crate::state::AppState;
use card_core::render::{document_info, DocumentInfo};
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Open a PDF and return its page count and per-page sizes (points).
#[tauri::command]
pub async fn open_pdf(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<DocumentInfo, String> {
    let pdfium = state.pdfium(&app)?;
    let path = PathBuf::from(path);
    let info = document_info(&pdfium, &path).map_err(|e| e.to_string())?;
    state.set_path(path);
    Ok(info)
}
