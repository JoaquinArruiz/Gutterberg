use serde::Serialize;

/// What the app knows about itself that the web side cannot: the pdfium build it was made with, and whether it came
/// from the Microsoft Store.
#[derive(Serialize)]
pub struct AppInfo {
    /// The pdfium build number (empty when it could not be read when the app was built).
    pdfium: String,
    /// Installed from the Microsoft Store, which updates it: the web side has no updates to offer.
    store: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        pdfium: env!("PDFIUM_BUILD").to_string(),
        store: crate::store::is_store_install(),
    }
}
