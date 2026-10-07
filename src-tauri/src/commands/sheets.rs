use super::export::same_file;
use crate::state::AppState;
use card_core::card::{PageGroup, DEFAULT_DOCUMENT_ID};
use card_core::export::{export_sheets_file, plan_print_file, PageIssue};
use card_core::geometry::PageSize;
use card_core::sheet::{
    extract_cards, plan_print, Card, CardSetting, OutputSheet, PaginateOptions, PrintLayout,
};
use std::path::PathBuf;
use tauri::State;

/// Every card of the page groups, in page order: the card library. Pure geometry like
/// `compute_layout` (no PDF is read); `pages` are the sizes the UI shows.
#[tauri::command]
pub fn compute_cards(pages: Vec<PageSize>, groups: Vec<PageGroup>) -> Result<Vec<Card>, String> {
    extract_cards(DEFAULT_DOCUMENT_ID, &pages, &groups).map_err(|e| e.to_string())
}

/// Output sheets for the preview: the same planner the export runs (`plan_print`), fed with
/// the page sizes the UI shows.
#[tauri::command]
pub fn compute_sheets(
    pages: Vec<PageSize>,
    groups: Vec<PageGroup>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
) -> Result<Vec<OutputSheet>, String> {
    plan_print(
        DEFAULT_DOCUMENT_ID,
        &pages,
        &groups,
        &settings,
        &layout,
        &options.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

/// Pre-flight for the print stage: plans the sheets exactly as the export will and lists the
/// pages that would make it fail. An error string means the plan itself does not work (cards
/// that do not fit the sheet, ...). Empty = good to export.
#[tauri::command]
pub async fn validate_print(
    state: State<'_, AppState>,
    groups: Vec<PageGroup>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
) -> Result<Vec<PageIssue>, String> {
    let input = state.path()?;
    tauri::async_runtime::spawn_blocking(move || {
        plan_print_file(
            &input,
            &groups,
            &settings,
            &layout,
            &options.unwrap_or_default(),
        )
        .map(|(_, issues)| issues)
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Export the open PDF as the print stage plans it, writing `output_path`. Returns the number
/// of sheets written.
#[tauri::command]
pub async fn export_print(
    state: State<'_, AppState>,
    groups: Vec<PageGroup>,
    settings: Vec<CardSetting>,
    layout: PrintLayout,
    options: Option<PaginateOptions>,
    output_path: String,
) -> Result<usize, String> {
    let input = state.path()?;
    let output = PathBuf::from(output_path);
    if same_file(&input, &output) {
        return Err("choose a different file than the one that is open".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (sheets, issues) = plan_print_file(
            &input,
            &groups,
            &settings,
            &layout,
            &options.unwrap_or_default(),
        )
        .map_err(|e| e.to_string())?;
        if let Some(first) = issues.first() {
            return Err(format!("page {}: {}", first.page_index + 1, first.message));
        }
        if sheets.is_empty() {
            return Err("there is nothing to print".into());
        }
        export_sheets_file(&input, &output, &sheets).map_err(|e| e.to_string())?;
        Ok(sheets.len())
    })
    .await
    .map_err(|e| e.to_string())?
}
