use crate::state::AppState;
use card_core::export::{export_pdf, ExportJob, PageJob};
use card_core::layout::GridLayout;
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
    if same_file(&input, &output) {
        return Err("choose a different file than the one that is open".into());
    }
    let job = ExportJob {
        pages: (0..page_count)
            .map(|page_index| PageJob { page_index, grid })
            .collect(),
    };
    let written = job.pages.len();
    tauri::async_runtime::spawn_blocking(move || export_pdf(&input, &output, &job))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(written)
}
