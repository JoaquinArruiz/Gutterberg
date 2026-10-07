use card_core::card::{PageGroup, DEFAULT_DOCUMENT_ID};
use card_core::geometry::PageSize;
use card_core::sheet::{plan_sheets, CardSetting, OutputSheet, PaginateOptions, SheetSpec};

/// Output sheets for the preview: every card of the page groups once, in order, unless
/// `settings` change a card's quantity, turn or scale. Pure geometry like `compute_layout`
/// (no PDF is read), and the same engine the exporter uses. Not wired into the UI yet.
#[tauri::command]
pub fn compute_sheets(
    pages: Vec<PageSize>,
    groups: Vec<PageGroup>,
    settings: Vec<CardSetting>,
    spec: SheetSpec,
    options: Option<PaginateOptions>,
) -> Result<Vec<OutputSheet>, String> {
    plan_sheets(
        DEFAULT_DOCUMENT_ID,
        &pages,
        &groups,
        &settings,
        &spec,
        &options.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}
