use crate::state::{internal, AppState};
use card_core::card::DocumentId;
use card_core::export::{
    export_pdf, same_file, same_file_error, validate_export_file, ExportJob, PageIssue, PageJob,
};
use card_core::ErrorInfo;
use std::path::PathBuf;
use tauri::State;

/// Export an open PDF: one output page per job, each with its own grid, writing
/// `output_path`. Pages without a job (skipped pages) are left out. Returns the number of
/// pages written.
#[tauri::command]
pub async fn export_document(
    state: State<'_, AppState>,
    document_id: DocumentId,
    pages: Vec<PageJob>,
    output_path: String,
) -> Result<usize, ErrorInfo> {
    let input = state.path(document_id)?;
    let output = PathBuf::from(output_path);
    if same_file(&input, &output) {
        return Err(same_file_error());
    }
    if pages.is_empty() {
        return Err(ErrorInfo::new(
            "no_pages",
            "no pages are included in the export",
        ));
    }
    let job = ExportJob { pages };
    let written = job.pages.len();
    tauri::async_runtime::spawn_blocking(move || export_pdf(&input, &output, &job))
        .await
        .map_err(internal)??;
    Ok(written)
}

/// Pre-flight: the pages that would make `export_document` fail for these jobs, found
/// with the same checks, before the save dialog opens. Empty = good to export.
#[tauri::command]
pub async fn validate_export(
    state: State<'_, AppState>,
    document_id: DocumentId,
    pages: Vec<PageJob>,
) -> Result<Vec<PageIssue>, ErrorInfo> {
    let input = state.path(document_id)?;
    let issues = tauri::async_runtime::spawn_blocking(move || validate_export_file(&input, &pages))
        .await
        .map_err(internal)??;
    Ok(issues
        .into_iter()
        .map(|i| i.in_document(document_id))
        .collect())
}
