use crate::state::AppState;
use card_core::ErrorInfo;
use tauri::State;

/// The project file the app was started with, once: the web side asks for it when it starts. From then
/// on files reach it as `opened-file` events instead (see `lib.rs`).
#[tauri::command]
pub fn take_opened_file(state: State<'_, AppState>) -> Result<Option<String>, ErrorInfo> {
    state.take_opened()
}
