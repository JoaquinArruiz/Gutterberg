use crate::state::{internal, AppState};
use card_core::card::DocumentId;
use card_core::export::{same_file, same_file_error, PageIssue};
use card_core::finish::plan_and_finish;
use card_core::geometry::PageSize;
use card_core::print_request::{
    document_sources, export_files, plan_files, print_request, OutputSettings, PrintProject,
    PrintRequest, ProjectDocument,
};
use card_core::sheet::{extract_all_cards, Card, OutputSheet};
use card_core::ErrorInfo;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;

/// Page sizes by document id, as the UI shows them.
type Pages = HashMap<DocumentId, Vec<PageSize>>;

/// Every card of the documents' page groups, in page order, one document after the other: the
/// piece library. Pure geometry like `compute_layout` (no PDF is read); the pages carry the
/// sizes the UI shows.
#[tauri::command]
pub fn compute_cards(
    documents: Vec<ProjectDocument>,
    output: OutputSettings,
    pages: Pages,
) -> Result<Vec<Card>, ErrorInfo> {
    Ok(extract_all_cards(&document_sources(
        &documents, &output, &pages,
    ))?)
}

/// Output sheets for the preview: the request built from the project as the export builds it, and
/// the same planner the export runs (`plan_and_finish`), fed with the page sizes the UI shows.
#[tauri::command]
pub fn compute_sheets(project: PrintProject, pages: Pages) -> Result<Vec<OutputSheet>, ErrorInfo> {
    let req = print_request(&project, &pages)?;
    // Pages the bleed cannot be taken from are reported by `validate_print`; the preview shows
    // them as a warning on the sheet.
    Ok(plan_and_finish(
        &req.sources(&pages),
        &req.settings,
        &req.layout,
        &req.options,
        &req.finishing,
    )?
    .0)
}

/// The open file behind each document of the request.
fn files_of(state: &AppState, req: &PrintRequest) -> Result<Vec<(u32, PathBuf)>, ErrorInfo> {
    req.documents
        .iter()
        .map(|d| Ok((d.document_id, state.path(d.document_id)?)))
        .collect()
}

fn borrowed(files: &[(u32, PathBuf)]) -> Vec<(u32, &Path)> {
    files.iter().map(|(id, p)| (*id, p.as_path())).collect()
}

/// Pre-flight for the print stage: plans the sheets exactly as the export will and lists the
/// pages that would make it fail. An error string means the plan itself does not work (pieces
/// that do not fit the sheet, ...). Empty = good to export.
#[tauri::command]
pub async fn validate_print(
    state: State<'_, AppState>,
    project: PrintProject,
    pages: Pages,
) -> Result<Vec<PageIssue>, ErrorInfo> {
    let req = print_request(&project, &pages)?;
    let files = files_of(&state, &req)?;
    tauri::async_runtime::spawn_blocking(move || {
        plan_files(&req, &borrowed(&files))
            .map(|(_, issues)| issues)
            .map_err(ErrorInfo::from)
    })
    .await
    .map_err(internal)?
}

/// Export the project's PDFs as the print stage plans it, writing `output_path`. Returns the
/// number of sheets written.
#[tauri::command]
pub async fn export_print(
    state: State<'_, AppState>,
    project: PrintProject,
    pages: Pages,
    output_path: String,
) -> Result<usize, ErrorInfo> {
    let req = print_request(&project, &pages)?;
    let files = files_of(&state, &req)?;
    let output = PathBuf::from(output_path);
    if files.iter().any(|(_, input)| same_file(input, &output)) {
        return Err(same_file_error());
    }
    tauri::async_runtime::spawn_blocking(move || export_files(&req, &borrowed(&files), &output))
        .await
        .map_err(internal)?
}
