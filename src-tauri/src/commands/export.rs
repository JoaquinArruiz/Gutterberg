use crate::state::AppState;
use card_core::export::{export_pdf, ExportJob, PageJob};
use card_core::layout::GridLayout;
use std::path::PathBuf;
use tauri::State;

/// Export the open PDF with `grid` applied to every page, writing `output_path`.
/// Returns the number of pages written.
#[tauri::command]
pub async fn export_document(
    state: State<'_, AppState>,
    grid: GridLayout,
    page_count: usize,
    output_path: String,
) -> Result<usize, String> {
    let input = state.path()?;
    let output = PathBuf::from(output_path);
    if output == input {
        return Err("choose a different file than the one that is open".into());
    }
    let job = ExportJob { pages: (0..page_count).map(|page_index| PageJob { page_index, grid }).collect() };
    export_pdf(&input, &output, &job).map_err(|e| e.to_string())?;
    Ok(job.pages.len())
}
