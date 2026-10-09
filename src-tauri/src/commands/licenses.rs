use serde::Serialize;

/// Gutterberg's own license, and the notices of the software it ships with. Both are part of the program
/// itself, so every installer carries them and the About section can show them offline.
const APP_LICENSE: &str = include_str!("../../../LICENSE");
const THIRD_PARTY_LICENSES: &str = include_str!("../../resources/THIRD_PARTY_LICENSES");

#[derive(Serialize)]
pub struct LicenseTexts {
    app: &'static str,
    third_party: &'static str,
}

#[tauri::command]
pub fn license_texts() -> LicenseTexts {
    LicenseTexts {
        app: APP_LICENSE,
        third_party: THIRD_PARTY_LICENSES,
    }
}
