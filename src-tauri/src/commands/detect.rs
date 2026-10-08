use crate::state::{internal, AppState};
use card_core::card::DocumentId;
use card_core::detect::Detection;
use card_core::ErrorInfo;
use tauri::{AppHandle, State};

/// Where the pieces seem to be on a page (0-based) of an open document, found locally: the page's
/// own objects first, then repeating edges, then shapes. Proposals come best first, in points of
/// the page as displayed; nothing is applied.
#[tauri::command]
pub async fn detect_pieces(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: DocumentId,
    page_index: usize,
) -> Result<Detection, ErrorInfo> {
    let worker = state.worker(&app)?;
    tauri::async_runtime::spawn_blocking(move || worker.detect(document_id, page_index))
        .await
        .map_err(internal)?
        .map_err(ErrorInfo::from)
}
