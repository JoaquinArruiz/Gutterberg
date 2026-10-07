use crate::state::AppState;
use card_core::export::{export_pdf, validate_export_file, ExportJob, PageIssue, PageJob};
use std::path::{Path, PathBuf};
use tauri::State;

/// Whether `output` is the same file as `input`, after resolving symlinks and `..`.
/// The output may not exist yet, so its folder is resolved instead.
fn same_file(input: &Path, output: &Path) -> bool {
    let resolved = output.canonicalize().or_else(|_| {
        let name = output.file_name().ok_or(std::io::ErrorKind::InvalidInput)?;
        let dir = output
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        dir.canonicalize().map(|d| d.join(name))
    });
    match (input.canonicalize(), resolved) {
        (Ok(a), Ok(b)) => a == b,
        _ => input == output,
    }
}

/// Export the open PDF: one output page per job, each with its own grid, writing
/// `output_path`. Pages without a job (skipped pages) are left out. Returns the number of
/// pages written.
#[tauri::command]
pub async fn export_document(
    state: State<'_, AppState>,
    pages: Vec<PageJob>,
    output_path: String,
) -> Result<usize, String> {
    let input = state.path()?;
    let output = PathBuf::from(output_path);
    if same_file(&input, &output) {
        return Err("choose a different file than the one that is open".into());
    }
    if pages.is_empty() {
        return Err("no pages are included in the export".into());
    }
    let job = ExportJob { pages };
    let written = job.pages.len();
    tauri::async_runtime::spawn_blocking(move || export_pdf(&input, &output, &job))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(written)
}

/// Pre-flight: the pages that would make `export_document` fail for these jobs, found
/// with the same checks, before the save dialog opens. Empty = good to export.
#[tauri::command]
pub async fn validate_export(
    state: State<'_, AppState>,
    pages: Vec<PageJob>,
) -> Result<Vec<PageIssue>, String> {
    let input = state.path()?;
    tauri::async_runtime::spawn_blocking(move || validate_export_file(&input, &pages))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
