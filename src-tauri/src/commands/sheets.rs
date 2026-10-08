use super::export::{same_file, same_file_error};
use crate::state::{internal, AppState};
use card_core::card::PageGroup;
use card_core::export::{export_sheets_files, plan_print_files, PageIssue, SourceFile};
use card_core::finish::{finish_sheets, Finishing};
use card_core::sheet::{
    extract_all_cards, plan_print_in, Card, CardSetting, DocumentSource, OutputSheet,
    PaginateOptions, PrintLayout,
};
use card_core::{ErrorInfo, ErrorParam};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// A document of the project as an export request names it: which PDF, and where its cards
/// are. The page sizes come from the file itself.
#[derive(Debug, Clone, Deserialize)]
pub struct DocumentGroups {
    pub document_id: u32,
    pub groups: Vec<PageGroup>,
}

/// Every card of the documents' page groups, in page order, one document after the other: the
/// piece library. Pure geometry like `compute_layout` (no PDF is read); the pages carry the
/// sizes the UI shows.
#[tauri::command]
pub fn compute_cards(documents: Vec<DocumentSource>) -> Result<Vec<Card>, ErrorInfo> {
    Ok(extract_all_cards(&documents)?)
}

/// Output sheets for the preview: the same planner the export runs (`plan_print_in`), fed with
/// the page sizes the UI shows.
#[tauri::command]
pub fn compute_sheets(
    documents: Vec<DocumentSource>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
    finishing: Option<Finishing>,
) -> Result<Vec<OutputSheet>, ErrorInfo> {
    let planned = plan_print_in(&documents, &settings, &layout, &options.unwrap_or_default())?;
    // Pages the bleed cannot be taken from are reported by `validate_print`; the preview shows
    // them as a warning on the sheet.
    Ok(finish_sheets(planned, &documents, &finishing.unwrap_or_default())?.0)
}

/// The open file behind each document of the request.
fn files_of(
    state: &AppState,
    documents: &[DocumentGroups],
) -> Result<Vec<(u32, PathBuf)>, ErrorInfo> {
    documents
        .iter()
        .map(|d| Ok((d.document_id, state.path(d.document_id)?)))
        .collect()
}

fn sources<'a>(
    documents: &'a [DocumentGroups],
    files: &'a [(u32, PathBuf)],
) -> Vec<SourceFile<'a>> {
    documents
        .iter()
        .zip(files)
        .map(|(d, (id, path))| SourceFile {
            document_id: *id,
            path: path.as_path(),
            groups: &d.groups,
        })
        .collect()
}

/// Pre-flight for the print stage: plans the sheets exactly as the export will and lists the
/// pages that would make it fail. An error string means the plan itself does not work (pieces
/// that do not fit the sheet, ...). Empty = good to export.
#[tauri::command]
pub async fn validate_print(
    state: State<'_, AppState>,
    documents: Vec<DocumentGroups>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
    finishing: Option<Finishing>,
) -> Result<Vec<PageIssue>, ErrorInfo> {
    let files = files_of(&state, &documents)?;
    tauri::async_runtime::spawn_blocking(move || {
        plan_print_files(
            &sources(&documents, &files),
            &settings,
            &layout,
            &options.unwrap_or_default(),
            &finishing.unwrap_or_default(),
        )
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
    documents: Vec<DocumentGroups>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
    finishing: Option<Finishing>,
    output_path: String,
) -> Result<usize, ErrorInfo> {
    let files = files_of(&state, &documents)?;
    let output = PathBuf::from(output_path);
    if files.iter().any(|(_, input)| same_file(input, &output)) {
        return Err(same_file_error());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (sheets, issues) = plan_print_files(
            &sources(&documents, &files),
            &settings,
            &layout,
            &options.unwrap_or_default(),
            &finishing.unwrap_or_default(),
        )?;
        if let Some(first) = issues.into_iter().next() {
            // The first page that cannot be exported: its own code, and which page it was.
            let mut info = ErrorInfo::new(&first.code, &first.message);
            info.params = first.params;
            info.message = format!("page {}: {}", first.page_index + 1, first.message);
            info.params.insert(
                "at_page".into(),
                ErrorParam::Number((first.page_index + 1) as f64),
            );
            return Err(info);
        }
        if sheets.is_empty() {
            return Err(ErrorInfo::new(
                "nothing_to_print",
                "there is nothing to print",
            ));
        }
        let inputs: Vec<(u32, &Path)> = files.iter().map(|(id, p)| (*id, p.as_path())).collect();
        export_sheets_files(&inputs, &output, &sheets)?;
        Ok(sheets.len())
    })
    .await
    .map_err(internal)?
}
