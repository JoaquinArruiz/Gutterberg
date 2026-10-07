use super::export::{same_file, same_file_error};
use crate::state::{internal, AppState};
use card_core::card::{PageGroup, DEFAULT_DOCUMENT_ID};
use card_core::export::{export_sheets_file, plan_print_file, PageIssue};
use card_core::geometry::PageSize;
use card_core::sheet::{
    extract_cards, plan_print, Card, CardSetting, OutputSheet, PaginateOptions, PrintLayout,
};
use card_core::{ErrorInfo, ErrorParam};
use std::path::PathBuf;
use tauri::State;

/// Every card of the page groups, in page order: the card library. Pure geometry like
/// `compute_layout` (no PDF is read); `pages` are the sizes the UI shows.
#[tauri::command]
pub fn compute_cards(pages: Vec<PageSize>, groups: Vec<PageGroup>) -> Result<Vec<Card>, ErrorInfo> {
    Ok(extract_cards(DEFAULT_DOCUMENT_ID, &pages, &groups)?)
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
) -> Result<Vec<OutputSheet>, ErrorInfo> {
    Ok(plan_print(
        DEFAULT_DOCUMENT_ID,
        &pages,
        &groups,
        &settings,
        &layout,
        &options.unwrap_or_default(),
    )?)
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
) -> Result<Vec<PageIssue>, ErrorInfo> {
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
        .map_err(ErrorInfo::from)
    })
    .await
    .map_err(internal)?
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
) -> Result<usize, ErrorInfo> {
    let input = state.path()?;
    let output = PathBuf::from(output_path);
    if same_file(&input, &output) {
        return Err(same_file_error());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (sheets, issues) = plan_print_file(
            &input,
            &groups,
            &settings,
            &layout,
            &options.unwrap_or_default(),
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
        export_sheets_file(&input, &output, &sheets)?;
        Ok(sheets.len())
    })
    .await
    .map_err(internal)?
}
