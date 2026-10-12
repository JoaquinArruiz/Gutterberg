use crate::app_log;

/// The end of the app's log, for "Copy log" in Preferences › Help (empty when there is none yet).
#[tauri::command]
pub fn read_log() -> String {
    app_log::dir()
        .map(|dir| app_log::read_tail(&dir, app_log::TAIL_CHARS))
        .unwrap_or_default()
}
