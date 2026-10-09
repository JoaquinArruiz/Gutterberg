use serde::Serialize;

/// What the app knows about itself that the web side cannot: the pdfium build it was made with.
#[derive(Serialize)]
pub struct AppInfo {
    /// The pdfium build number (empty when it could not be read when the app was built).
    pdfium: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        pdfium: env!("PDFIUM_BUILD").to_string(),
    }
}
