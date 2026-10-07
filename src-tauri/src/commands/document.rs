use crate::state::{internal, AppState};
use card_core::card::DocumentId;
use card_core::render::DocumentInfo;
use card_core::ErrorInfo;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Open a PDF under `document_id` and return its page count and per-page sizes (points). The
/// render thread keeps the parsed document for later renders; a project keeps several open,
/// and opening an id again replaces what was open under it.
#[tauri::command]
pub async fn open_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: DocumentId,
    path: String,
) -> Result<DocumentInfo, ErrorInfo> {
    let worker = state.worker(&app)?;
    let path = PathBuf::from(path);
    let opened = path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || worker.open(document_id, opened))
        .await
        .map_err(internal)??;
    state.set_path(document_id, path)?;
    Ok(info)
}

/// Forget one open document, or every document (`document_id` of `None`): a new project starts
/// from nothing.
#[tauri::command]
pub async fn close_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: Option<DocumentId>,
) -> Result<(), ErrorInfo> {
    let worker = state.worker(&app)?;
    tauri::async_runtime::spawn_blocking(move || worker.close(document_id))
        .await
        .map_err(internal)??;
    state.clear_paths(document_id)
}
